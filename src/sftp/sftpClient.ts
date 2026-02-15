import * as vscode from 'vscode';
import { Client, SFTPWrapper, ConnectConfig } from 'ssh2';
import { Logger } from '../utils/logger';

// helper to map local log calls to Logger
function log(message: string): void {
    Logger.debug(`[SFTP] ${message}`);
}

export interface SftpConnectionInfo {
    host: string;
    port: number;
    username: string; // format: <panelUsername>.<serverIdentifier>
    privateKey?: string; // PEM-format private key
    password?: string; // fallback if no key
}

export interface SftpFileEntry {
    name: string;
    size: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
    modifyTime: number;
    accessTime: number;
    mode: number;
}

export class SftpClient {
    private client: Client | null = null;
    private sftp: SFTPWrapper | null = null;
    private connected = false;
    private connectionInfo: SftpConnectionInfo;

    // Connection mutex: prevents multiple simultaneous connect() calls
    private connectingPromise: Promise<void> | null = null;
    // Track consecutive failures to prevent infinite retry loops
    private consecutiveFailures = 0;
    private static readonly MAX_RETRIES = 1; // Reduced from 3 to 1 to fail fast and let user retry manually

    constructor(info: SftpConnectionInfo) {
        this.connectionInfo = info;
    }

    async connect(): Promise<void> {
        // If already connected, skip
        if (this.connected && this.sftp) {
            return;
        }

        // If another connect() is in progress, wait for it instead of starting a new one
        if (this.connectingPromise) {
            log(`  ⏳ Connection already in progress, waiting...`);
            return this.connectingPromise;
        }

        // Check retry limit
        if (this.consecutiveFailures >= SftpClient.MAX_RETRIES) {
            const msg = `Too many connection failures (${this.consecutiveFailures}). Use "Pterodactyl: Connect to Server" to retry.`;
            log(`  🛑 ${msg}`);
            throw new Error(msg);
        }

        // Set the mutex promise
        this.connectingPromise = this.doConnect();

        try {
            await this.connectingPromise;
        } finally {
            this.connectingPromise = null;
        }
    }

    private doConnect(): Promise<void> {
        const { host, port, username } = this.connectionInfo;
        log(`🔌 Connecting to ${host}:${port} as ${username}...`);

        return new Promise<void>((resolve, reject) => {
            // Clean up any existing client
            if (this.client) {
                try { this.client.end(); } catch { /* ignore */ }
                this.client = null;
                this.sftp = null;
            }

            this.client = new Client();

            const config: ConnectConfig = {
                host,
                port,
                username,
                readyTimeout: 10000, // Reduced from 15000
                keepaliveInterval: 10000,
                keepaliveCountMax: 3,
                algorithms: {
                    kex: [
                        'curve25519-sha256',
                        'curve25519-sha256@libssh.org',
                        'ecdh-sha2-nistp256',
                        'ecdh-sha2-nistp384',
                        'ecdh-sha2-nistp521',
                        'diffie-hellman-group14-sha256',
                    ],
                    cipher: [
                        'aes128-ctr',
                        'aes192-ctr',
                        'aes256-ctr',
                        'aes128-gcm@openssh.com',
                        'aes256-gcm@openssh.com',
                    ],
                    serverHostKey: [
                        'ssh-rsa',
                        'rsa-sha2-256',
                        'rsa-sha2-512',
                        'ecdsa-sha2-nistp256',
                        'ssh-ed25519',
                    ],
                    hmac: [
                        'hmac-sha2-256',
                        'hmac-sha2-512',
                        'hmac-sha1',
                    ],
                },
                debug: (msg: string) => {
                    // SSH2 debug output - filter common noise
                    if (msg.includes('DEBUG') || msg.includes('Received packet')) {
                        return; // Skip verbose packet logs
                    }
                    log(`  🔍 SSH2: ${msg}`);
                },
            };

            // Auth method
            if (this.connectionInfo.privateKey) {
                const keyPreview = this.connectionInfo.privateKey.substring(0, 50).replace(/\n/g, ' ');
                log(`  🔑 Auth: SSH private key (${keyPreview}...)`);
                config.privateKey = this.connectionInfo.privateKey;
            } else if (this.connectionInfo.password) {
                log(`  🔑 Auth: Password (${this.connectionInfo.password.length} chars)`);
                config.password = this.connectionInfo.password;
            } else {
                const msg = 'No authentication method configured (no key and no password)';
                log(`  ❌ ${msg}`);
                this.consecutiveFailures++;
                reject(new Error(msg));
                return;
            }

            let settled = false;

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    const msg = `Connection timed out after 15s to ${host}:${port}`;
                    log(`  ❌ TIMEOUT: ${msg}`);
                    log(`  💡 Check: (1) SFTP host/port correct? (2) Firewall blocking? (3) Server running?`);
                    this.consecutiveFailures++;
                    try { this.client?.end(); } catch { /* ignore */ }
                    reject(new Error(msg));
                }
            }, 12000); // reduced timeout safety buffer

            this.client.on('banner', (msg: string) => {
                log(`  📢 Server banner: ${msg.trim()}`);
            });

            this.client.on('greeting', (msg: string) => {
                log(`  👋 Server greeting: ${msg.trim()}`);
            });

            this.client.on('ready', () => {
                log(`  ✅ SSH handshake complete, requesting SFTP subsystem...`);
                this.client!.sftp((err, sftp) => {
                    if (settled) { return; }
                    clearTimeout(timeout);

                    if (err) {
                        settled = true;
                        log(`  ❌ SFTP subsystem failed: ${err.message}`);
                        log(`  💡 The SSH connection worked, but SFTP subsystem is unavailable`);
                        log(`  💡 Check: Is SFTP enabled on the server?`);
                        this.consecutiveFailures++;
                        reject(new Error(`SFTP session failed: ${err.message}`));
                        return;
                    }
                    settled = true;
                    this.sftp = sftp;
                    this.connected = true;
                    this.consecutiveFailures = 0; // reset on success
                    log(`  ✅ SFTP session established successfully`);
                    resolve();
                });
            });

            this.client.on('error', (err: any) => {
                clearTimeout(timeout);
                const errCode = err.level || err.code || 'UNKNOWN';
                const errMsg = err.message || String(err);

                if (!settled) {
                    settled = true;
                    log(`  ❌ SSH ERROR [${errCode}]: ${errMsg}`);

                    // Provide specific help based on error type
                    if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
                        log(`  💡 DNS lookup failed - hostname "${host}" cannot be resolved`);
                        log(`  💡 Check: Is the SFTP host correct in server settings?`);
                    } else if (errMsg.includes('ECONNREFUSED')) {
                        log(`  💡 Connection refused - nothing listening on ${host}:${port}`);
                        log(`  💡 Check: Is the SFTP port correct? Is the server running?`);
                    } else if (errMsg.includes('ETIMEDOUT')) {
                        log(`  💡 Connection timed out - host is unreachable or firewalled`);
                        log(`  💡 Check: Firewall settings, network connectivity`);
                    } else if (errMsg.includes('All configured authentication methods failed')) {
                        log(`  💡 Authentication failed with all methods`);
                        if (this.connectionInfo.privateKey) {
                            log(`  💡 Check: Is the SSH public key added to the panel? (Account → SSH Keys)`);
                            log(`  💡 Check: Does the private key match the public key on the panel?`);
                            log(`  💡 Check: Is the username correct? Should be: ${username}`);
                        } else {
                            log(`  💡 Check: Is the password correct?`);
                        }
                    } else if (errMsg.includes('Handshake failed')) {
                        log(`  💡 SSH handshake failed - incompatible SSH versions or algorithms?`);
                    }

                    this.consecutiveFailures++;
                    this.connected = false;
                    this.sftp = null;
                    reject(new Error(`SSH connection error [${errCode}]: ${errMsg}`));
                } else {
                    log(`  ⚠️ SSH error (post-connect) [${errCode}]: ${errMsg}`);
                    this.connected = false;
                    this.sftp = null;
                }
            });

            this.client.on('end', () => {
                log(`  ⚠️ SSH connection ended by server (${host}:${port})`);
                this.connected = false;
                this.sftp = null;
            });

            this.client.on('close', () => {
                log(`  ⚠️ SSH connection closed for ${host}:${port}`);
                this.connected = false;
                this.sftp = null;
            });

            this.client.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
                log(`  🔐 Keyboard-interactive auth requested (${prompts.length} prompts)`);
                if (this.connectionInfo.password) {
                    log(`  🔐 Responding with password...`);
                    finish([this.connectionInfo.password]);
                } else {
                    log(`  ⚠️ No password configured for keyboard-interactive`);
                    finish([]);
                }
            });

            log(`  🚀 Initiating SSH connection...`);
            try {
                this.client.connect(config);
            } catch (err: any) {
                clearTimeout(timeout);
                if (!settled) {
                    settled = true;
                    log(`  ❌ Failed to initiate connection: ${err.message}`);
                    this.consecutiveFailures++;
                    reject(new Error(`Failed to start SSH client: ${err.message}`));
                }
            }
        });
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            const { host, port } = this.connectionInfo;
            log(`Disconnecting from ${host}:${port}`);
            try { this.client.end(); } catch { /* ignore */ }
            this.client = null;
            this.sftp = null;
            this.connected = false;
            this.consecutiveFailures = 0; // Reset on manual disconnect
        }
    }

    /** Reset failure counter so reconnect can be attempted again */
    resetRetries(): void {
        this.consecutiveFailures = 0;
    }

    private async ensureConnected(): Promise<SFTPWrapper> {
        if (!this.connected || !this.sftp) {
            log(`Auto-reconnecting...`);
            await this.connect();
        }
        if (!this.sftp) {
            throw new Error('SFTP session not available after connect');
        }
        return this.sftp;
    }

    async list(directory: string): Promise<SftpFileEntry[]> {
        const sftp = await this.ensureConnected();
        log(`LIST ${directory}`);
        return new Promise((resolve, reject) => {
            sftp.readdir(directory, (err, list) => {
                if (err) {
                    // Suppress log for common errors or lower level
                    if (err.message === 'no such file') {
                        log(`  ℹ️ LIST ${directory}: no such file`);
                    } else {
                        log(`  ❌ LIST failed: ${err.message}`);
                    }
                    reject(new Error(`Failed to list ${directory}: ${err.message}`));
                    return;
                }
                const entries = list
                    .filter(item => item.filename !== '.' && item.filename !== '..')
                    .map(item => ({
                        name: item.filename,
                        size: item.attrs.size,
                        isDirectory: (item.attrs.mode! & 0o40000) !== 0,
                        isFile: (item.attrs.mode! & 0o100000) !== 0,
                        isSymlink: (item.attrs.mode! & 0o120000) === 0o120000,
                        modifyTime: item.attrs.mtime * 1000,
                        accessTime: item.attrs.atime * 1000,
                        mode: item.attrs.mode!,
                    }));
                log(`  ✅ ${entries.length} entries`);
                resolve(entries);
            });
        });
    }

    async stat(filePath: string): Promise<SftpFileEntry> {
        const sftp = await this.ensureConnected();
        return new Promise((resolve, reject) => {
            sftp.stat(filePath, (err, stats) => {
                if (err) {
                    if (err.message === 'no such file') {
                        log(`  ℹ️ STAT ${filePath}: no such file`);
                    } else {
                        log(`  ❌ STAT ${filePath}: ${err.message}`);
                    }
                    reject(new Error(`Failed to stat ${filePath}: ${err.message}`));
                    return;
                }
                const name = filePath.split(/[/\\]/).pop() || '';
                resolve({
                    name,
                    size: stats.size,
                    isDirectory: (stats.mode! & 0o40000) !== 0,
                    isFile: (stats.mode! & 0o100000) !== 0,
                    isSymlink: (stats.mode! & 0o120000) === 0o120000,
                    modifyTime: stats.mtime * 1000,
                    accessTime: stats.atime * 1000,
                    mode: stats.mode!,
                });
            });
        });
    }

    async readFile(filePath: string): Promise<Buffer> {
        const sftp = await this.ensureConnected();
        log(`READ ${filePath}`);
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            const stream = sftp.createReadStream(filePath);

            stream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            stream.on('end', () => {
                const buf = Buffer.concat(chunks);
                log(`  ✅ Read ${buf.length} bytes`);
                resolve(buf);
            });

            stream.on('error', (err: Error) => {
                if (err.message === 'no such file') {
                    log(`  ℹ️ READ ${filePath}: no such file`);
                } else {
                    log(`  ❌ READ failed: ${err.message}`);
                }
                reject(new Error(`Failed to read ${filePath}: ${err.message}`));
            });
        });
    }

    async writeFile(filePath: string, data: Buffer): Promise<void> {
        const sftp = await this.ensureConnected();
        log(`WRITE ${filePath} (${data.length} bytes)`);
        return new Promise((resolve, reject) => {
            const stream = sftp.createWriteStream(filePath);

            stream.on('close', () => {
                log(`  ✅ Written`);
                resolve();
            });

            stream.on('error', (err: Error) => {
                log(`  ❌ WRITE failed: ${err.message}`);
                reject(new Error(`Failed to write ${filePath}: ${err.message}`));
            });

            stream.end(data);
        });
    }

    async mkdir(dirPath: string): Promise<void> {
        const sftp = await this.ensureConnected();
        log(`MKDIR ${dirPath}`);
        return new Promise((resolve, reject) => {
            sftp.mkdir(dirPath, (err) => {
                if (err) {
                    log(`  ❌ MKDIR failed: ${err.message}`);
                    reject(new Error(`Failed to create directory ${dirPath}: ${err.message}`));
                    return;
                }
                log(`  ✅ Created`);
                resolve();
            });
        });
    }

    async delete(filePath: string): Promise<void> {
        const sftp = await this.ensureConnected();
        log(`DELETE ${filePath}`);
        return new Promise((resolve, reject) => {
            sftp.unlink(filePath, (err) => {
                if (err) {
                    sftp.rmdir(filePath, (err2) => {
                        if (err2) {
                            log(`  ❌ DELETE failed: ${err2.message}`);
                            reject(new Error(`Failed to delete ${filePath}: ${err2.message}`));
                            return;
                        }
                        log(`  ✅ Deleted (dir)`);
                        resolve();
                    });
                    return;
                }
                log(`  ✅ Deleted (file)`);
                resolve();
            });
        });
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        const sftp = await this.ensureConnected();
        log(`RENAME ${oldPath} → ${newPath}`);
        return new Promise((resolve, reject) => {
            sftp.rename(oldPath, newPath, (err) => {
                if (err) {
                    log(`  ❌ RENAME failed: ${err.message}`);
                    reject(new Error(`Failed to rename ${oldPath} to ${newPath}: ${err.message}`));
                    return;
                }
                log(`  ✅ Renamed`);
                resolve();
            });
        });
    }

    async chmod(filePath: string, mode: number): Promise<void> {
        const sftp = await this.ensureConnected();
        return new Promise((resolve, reject) => {
            sftp.chmod(filePath, mode, (err) => {
                if (err) {
                    reject(new Error(`Failed to chmod ${filePath}: ${err.message}`));
                    return;
                }
                resolve();
            });
        });
    }

    isConnected(): boolean {
        return this.connected;
    }

    /** Show the debug output channel to the user */
    static showDebugLog(): void {
        Logger.show();
    }
}
