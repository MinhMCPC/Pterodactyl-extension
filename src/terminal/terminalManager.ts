import * as vscode from 'vscode';
import WebSocket from 'ws';
import { PterodactylClient } from '../api/pterodactylClient';
import { Logger } from '../utils/logger';

export class PteroTerminal {
    private pty: vscode.Pseudoterminal;
    private writeEmitter: vscode.EventEmitter<string>;
    private closeEmitter: vscode.EventEmitter<number>;
    private terminal: vscode.Terminal | null = null;
    private ws: WebSocket | null = null;
    private token: string = '';
    private socketUrl: string = '';
    private inputBuffer: string = '';
    private cursor: number = 0;
    private history: string[] = [];
    private historyIndex: number = -1;
    private lastCommand: string = '';
    private isDisposing: boolean = false;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(
        private serverName: string,
        private serverUuid: string,
        private apiClient: PterodactylClient
    ) {
        this.writeEmitter = new vscode.EventEmitter<string>();
        this.closeEmitter = new vscode.EventEmitter<number>();

        this.pty = {
            onDidWrite: this.writeEmitter.event,
            onDidClose: this.closeEmitter.event,
            open: async () => {
                await this.connect();
            },
            close: () => {
                this.disconnect();
            },
            handleInput: (data: string) => {

                if (data === '\r') { // Enter
                    this.write('\r\n');
                    const cmd = this.inputBuffer.trim();
                    if (cmd.length > 0) {
                        this.history.push(cmd);
                        this.historyIndex = -1;
                        this.lastCommand = cmd;
                        this.apiClient.sendCommand(this.serverUuid, this.inputBuffer)
                            .catch(err => {
                                this.write(`\x1b[2K\r❌ Failed to send: ${err.message}\r\n`);
                            });
                    }
                    this.inputBuffer = '';
                    this.cursor = 0;
                    this.write('> ');
                } else if (data === '\x7f') { // Backspace
                    if (this.cursor > 0) {
                        // Remove char at cursor-1
                        this.inputBuffer = this.inputBuffer.slice(0, this.cursor - 1) + this.inputBuffer.slice(this.cursor);
                        this.cursor--;
                        this.refreshLine();
                    }
                } else if (data === '\x1b[A') { // Up (History Back)
                    if (this.history.length > 0) {
                        if (this.historyIndex === -1) {
                            this.historyIndex = this.history.length - 1;
                        } else if (this.historyIndex > 0) {
                            this.historyIndex--;
                        }
                        this.inputBuffer = this.history[this.historyIndex];
                        this.cursor = this.inputBuffer.length;
                        this.refreshLine();
                    }
                } else if (data === '\x1b[B') { // Down (History Forward)
                    if (this.historyIndex !== -1) {
                        if (this.historyIndex < this.history.length - 1) {
                            this.historyIndex++;
                            this.inputBuffer = this.history[this.historyIndex];
                        } else {
                            this.historyIndex = -1;
                            this.inputBuffer = '';
                        }
                        this.cursor = this.inputBuffer.length;
                        this.refreshLine();
                    }
                } else if (data === '\x1b[D') { // Left
                    if (this.cursor > 0) {
                        this.cursor--;
                        this.write('\x1b[D');
                    }
                } else if (data === '\x1b[C') { // Right
                    if (this.cursor < this.inputBuffer.length) {
                        this.cursor++;
                        this.write('\x1b[C');
                    }
                } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
                    // Regular character (insert at cursor)
                    this.inputBuffer = this.inputBuffer.slice(0, this.cursor) + data + this.inputBuffer.slice(this.cursor);
                    this.cursor++;
                    this.refreshLine();
                }
            },
        };
    }

    async show(): Promise<void> {
        this.terminal = vscode.window.createTerminal({
            name: `🦕 ${this.serverName}`,
            pty: this.pty,
        });
        this.terminal.show();
    }

    private async connect(): Promise<void> {
        try {
            // Get WebSocket credentials
            const creds = await this.apiClient.getWebSocketCredentials(this.serverUuid);
            this.token = creds.token;
            this.socketUrl = creds.socket;

            this.socketUrl = creds.socket;

            Logger.info(`Terminal connecting to ${this.serverName} (${this.serverUuid})`);
            this.write(`\r\n🔌 Connecting to ${this.serverName}...\r\n`);

            // Create WebSocket connection
            this.ws = new WebSocket(this.socketUrl, {
                origin: this.apiClient.panelUrl
            });

            this.ws.on('open', () => {
                // Authenticate
                this.ws!.send(JSON.stringify({
                    event: 'auth',
                    args: [this.token]
                }));
                this.write(`✅ Connected to Wings daemon\r\n> `);
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(msg);
                } catch (err) {
                    // Might be raw output
                    this.write(data.toString());
                }
            });

            this.ws.on('error', (err) => {
                Logger.error(`Terminal WebSocket error for ${this.serverName}`, err);
                this.write(`\r\n❌ WebSocket error: ${err.message}\r\n`);
            });

            this.ws.on('close', () => {
                if (!this.isDisposing) {
                    this.write(`\r\n⚠️ Connection closed, reconnecting in 3s...\r\n`);
                    this.reconnectTimer = setTimeout(() => this.reconnect(), 3000);
                }
            });

        } catch (err: any) {
            this.write(`\r\n❌ Failed to connect: ${err.message}\r\n`);
        }
    }

    private handleMessage(msg: any): void {
        switch (msg.event) {
            case 'auth success':
                this.write(`🔐 Authenticated successfully\r\n\r\n`);
                // Request log history
                this.ws?.send(JSON.stringify({
                    event: 'send logs',
                    args: [null]
                }));
                break;
            case 'console output':
                // Wings sends console output
                let output = Array.isArray(msg.args) ? msg.args[0] : msg.args;
                if (Array.isArray(output)) {
                    output = output.join('\n');
                }

                // Suppress command echo if it matches exactly
                if (this.lastCommand && output.trim() === this.lastCommand) {
                    this.lastCommand = ''; // Clear so future occurrences are shown
                    return;
                }

                // Clear current line, move to start, write log, newline, restore prompt + buffer
                this.write(`\x1b[2K\r${output}\r\n`);
                this.refreshLine();
                break;
            case 'status':
                const status = Array.isArray(msg.args) ? msg.args[0] : msg.args;
                this.write(`\r\n\x1b[2K\r📊 Server status: ${status}\r\n`);
                this.refreshLine();
                break;
            case 'stats':
                // Resource stats - ignore for now to avoid spam
                break;
            case 'token expiring':
                this.write(`\r\n🔄 Token expiring, refreshing...\r\n`);
                this.refreshToken();
                break;
            case 'token expired':
                this.write(`\r\n⚠️ Token expired, reconnecting...\r\n`);
                this.reconnect();
                break;
            default:
                // Log unknown events
                if (msg.event) {
                    this.write(`\r\n[${msg.event}]\r\n`);
                }
        }
    }

    private write(text: string): void {
        this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
    }

    private async refreshToken(): Promise<void> {
        try {
            const creds = await this.apiClient.getWebSocketCredentials(this.serverUuid);
            this.token = creds.token;
            // Send new token
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: 'auth',
                    args: [this.token]
                }));
            }
        } catch (err: any) {
            this.write(`\r\n❌ Failed to refresh token: ${err.message}\r\n`);
        }
    }

    private async reconnect(): Promise<void> {
        this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.connect();
    }

    private disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    dispose(): void {
        this.isDisposing = true;
        this.disconnect();
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
    private refreshLine(): void {
        // Clear line, write prompt + buffer, move cursor to position
        // \x1b[2K \r > buffer
        // Then move cursor back if needed?
        // Actually: \r > buffer \x1b[K (clear rest)
        // Then move cursor: \r then right (cursor + 2)
        this.write(`\x1b[2K\r> ${this.inputBuffer}`);
        // Move cursor to correct position (prompt is 2 chars)
        // We are at end of line now.
        // We know total length is inputBuffer.length + 2.
        // We want to be at cursor + 2.
        // So move left by (inputBuffer.length - cursor) ?
        const dist = this.inputBuffer.length - this.cursor;
        if (dist > 0) {
            this.write(`\x1b[${dist}D`);
        }
    }
}

export class TerminalManager {
    private terminals: Map<string, PteroTerminal> = new Map();

    async openTerminal(
        serverIdentifier: string,
        serverName: string,
        serverUuid: string,
        apiClient: PterodactylClient
    ): Promise<void> {
        // Check if terminal already exists
        const existing = this.terminals.get(serverIdentifier);
        if (existing) {
            vscode.window.showInformationMessage(`Terminal for "${serverName}" is already open.`);
            return;
        }

        // Create new terminal
        const terminal = new PteroTerminal(serverName, serverUuid, apiClient);
        this.terminals.set(serverIdentifier, terminal);
        await terminal.show();
    }

    closeTerminal(serverIdentifier: string): void {
        const terminal = this.terminals.get(serverIdentifier);
        if (terminal) {
            terminal.dispose();
            this.terminals.delete(serverIdentifier);
        }
    }

    dispose(): void {
        for (const terminal of this.terminals.values()) {
            terminal.dispose();
        }
        this.terminals.clear();
    }
}
