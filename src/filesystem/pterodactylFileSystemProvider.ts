import * as vscode from 'vscode';
import * as fs from 'fs';
import { PteroAccount } from '../api/pterodactylClient';
import { SftpClient, SftpConnectionInfo } from '../sftp/sftpClient';

interface ServerConnection {
    account: PteroAccount;
    serverIdentifier: string;
    serverName: string;
    sftpHost: string;
    sftpPort: number;
    sftpClient: SftpClient;
}

export class PterodactylFileSystemProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    private connections: Map<string, ServerConnection> = new Map();

    registerConnection(
        serverIdentifier: string,
        account: PteroAccount,
        serverName: string,
        sftpHost: string,
        sftpPort: number
    ): void {
        // Close existing connection if any
        const existing = this.connections.get(serverIdentifier);
        if (existing) {
            existing.sftpClient.disconnect();
        }

        // Read SSH private key: from file or pasted/generated content
        let privateKey: string | undefined;
        let password: string | undefined;

        if (account.sftpAuthMethod === 'ssh-key') {
            if (account.privateKeyPath) {
                try {
                    privateKey = fs.readFileSync(account.privateKeyPath, 'utf-8');
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to read SSH key file: ${err.message}`);
                }
            } else if (account.privateKeyData) {
                privateKey = account.privateKeyData;
            }
        } else {
            password = account.password;
        }

        const connInfo: SftpConnectionInfo = {
            host: sftpHost,
            port: sftpPort,
            username: `${account.username}.${serverIdentifier}`,
            privateKey,
            password,
        };

        this.connections.set(serverIdentifier, {
            account,
            serverIdentifier,
            serverName,
            sftpHost,
            sftpPort,
            sftpClient: new SftpClient(connInfo),
        });
    }

    private getClient(uri: vscode.Uri): SftpClient {
        const serverIdentifier = uri.authority;
        const conn = this.connections.get(serverIdentifier);
        if (!conn) {
            throw vscode.FileSystemError.Unavailable(`Not connected to server: ${serverIdentifier}`);
        }
        return conn.sftpClient;
    }

    private getFilePath(uri: vscode.Uri): string {
        // Always use forward slash for SFTP paths
        return (uri.path || '/').replace(/\\/g, '/');
    }

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return new vscode.Disposable(() => { });
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const filePath = this.getFilePath(uri);

        // Root directory
        if (filePath === '/' || filePath === '') {
            return {
                type: vscode.FileType.Directory,
                ctime: 0,
                mtime: Date.now(),
                size: 0,
            };
        }

        const client = this.getClient(uri);

        try {
            const entry = await client.stat(filePath);
            return {
                type: entry.isDirectory ? vscode.FileType.Directory :
                    entry.isSymlink ? vscode.FileType.SymbolicLink :
                        vscode.FileType.File,
                ctime: entry.accessTime,
                mtime: entry.modifyTime,
                size: entry.size,
            };
        } catch (err: any) {
            if (err.message.includes('No such file') || err.message.includes('not found')) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            throw vscode.FileSystemError.Unavailable(err.message);
        }
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const filePath = this.getFilePath(uri);
        const client = this.getClient(uri);

        try {
            const entries = await client.list(filePath);
            return entries.map(entry => [
                entry.name,
                entry.isDirectory ? vscode.FileType.Directory :
                    entry.isSymlink ? vscode.FileType.SymbolicLink :
                        vscode.FileType.File,
            ]);
        } catch (err: any) {
            throw vscode.FileSystemError.Unavailable(err.message);
        }
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const filePath = this.getFilePath(uri);
        const client = this.getClient(uri);

        try {
            const buffer = await client.readFile(filePath);
            return new Uint8Array(buffer);
        } catch (err: any) {
            if (err.message.includes('No such file')) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            throw vscode.FileSystemError.Unavailable(err.message);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): Promise<void> {
        const filePath = this.getFilePath(uri);
        const client = this.getClient(uri);

        try {
            await client.writeFile(filePath, Buffer.from(content));
            this._onDidChangeFile.fire([{
                type: vscode.FileChangeType.Changed,
                uri,
            }]);
        } catch (err: any) {
            throw vscode.FileSystemError.Unavailable(`Failed to write file: ${err.message}`);
        }
    }

    async delete(uri: vscode.Uri, _options: { recursive: boolean }): Promise<void> {
        const filePath = this.getFilePath(uri);
        const client = this.getClient(uri);

        try {
            await client.delete(filePath);
            this._onDidChangeFile.fire([{
                type: vscode.FileChangeType.Deleted,
                uri,
            }]);
        } catch (err: any) {
            throw vscode.FileSystemError.Unavailable(`Failed to delete: ${err.message}`);
        }
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { overwrite: boolean }): Promise<void> {
        const oldPath = this.getFilePath(oldUri);
        const newPath = this.getFilePath(newUri);
        const client = this.getClient(oldUri);

        try {
            await client.rename(oldPath, newPath);
            this._onDidChangeFile.fire([
                { type: vscode.FileChangeType.Deleted, uri: oldUri },
                { type: vscode.FileChangeType.Created, uri: newUri },
            ]);
        } catch (err: any) {
            throw vscode.FileSystemError.Unavailable(`Failed to rename: ${err.message}`);
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        const filePath = this.getFilePath(uri);
        const client = this.getClient(uri);

        try {
            await client.mkdir(filePath);
            this._onDidChangeFile.fire([{
                type: vscode.FileChangeType.Created,
                uri,
            }]);
        } catch (err: any) {
            throw vscode.FileSystemError.Unavailable(`Failed to create directory: ${err.message}`);
        }
    }

    clearCache(): void {
        // No cache with SFTP - direct protocol access
    }

    async disconnectAll(): Promise<void> {
        for (const conn of this.connections.values()) {
            await conn.sftpClient.disconnect();
        }
        this.connections.clear();
    }

    async disconnectServer(serverIdentifier: string): Promise<void> {
        const conn = this.connections.get(serverIdentifier);
        if (conn) {
            await conn.sftpClient.disconnect();
            this.connections.delete(serverIdentifier);
        }
    }

    async reconnect(serverIdentifier: string): Promise<void> {
        const conn = this.connections.get(serverIdentifier);
        if (!conn) {
            throw new Error(`No active connection found for ${serverIdentifier}`);
        }

        // Disconnect existing
        await conn.sftpClient.disconnect();

        // Re-register (creates new SftpClient)
        this.registerConnection(
            conn.serverIdentifier,
            conn.account,
            conn.serverName,
            conn.sftpHost,
            conn.sftpPort
        );
    }

    dispose(): void {
        this.disconnectAll();
        this._onDidChangeFile.dispose();
    }
}
