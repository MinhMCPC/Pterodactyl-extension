import * as vscode from 'vscode';

export class Logger {
    private static outputChannel: vscode.OutputChannel;

    static initialize() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Pterodactyl');
        }
    }

    private static log(level: string, message: string) {
        if (!this.outputChannel) {
            this.initialize();
        }
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }

    static info(message: string) {
        this.log('INFO', message);
    }

    static warn(message: string) {
        this.log('WARN', message);
    }

    static error(message: string, error?: any) {
        let errorMsg = message;
        if (error) {
            if (error instanceof Error) {
                errorMsg += `: ${error.message}\n${error.stack}`;
            } else {
                errorMsg += `: ${String(error)}`;
            }
        }
        this.log('ERROR', errorMsg);
        this.outputChannel.show(true); // Show channel on error
    }

    static debug(message: string) {
        this.log('DEBUG', message);
    }

    static show() {
        if (!this.outputChannel) {
            this.initialize();
        }
        this.outputChannel.show();
    }
}
