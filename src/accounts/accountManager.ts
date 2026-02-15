import * as vscode from 'vscode';
import { PteroAccount } from '../api/pterodactylClient';

const ACCOUNTS_KEY = 'pterodactyl.accounts';

export class AccountManager {
    private context: vscode.ExtensionContext;
    private _onDidChangeAccounts = new vscode.EventEmitter<void>();
    readonly onDidChangeAccounts = this._onDidChangeAccounts.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    getAccounts(): PteroAccount[] {
        return this.context.globalState.get<PteroAccount[]>(ACCOUNTS_KEY, []);
    }

    async addAccount(account: PteroAccount): Promise<void> {
        const accounts = this.getAccounts();
        accounts.push(account);
        await this.context.globalState.update(ACCOUNTS_KEY, accounts);
        this._onDidChangeAccounts.fire();
    }

    async editAccount(id: string, updated: Partial<PteroAccount>): Promise<void> {
        const accounts = this.getAccounts();
        const index = accounts.findIndex(a => a.id === id);
        if (index === -1) {
            throw new Error(`Account not found: ${id}`);
        }
        accounts[index] = { ...accounts[index], ...updated };
        await this.context.globalState.update(ACCOUNTS_KEY, accounts);
        this._onDidChangeAccounts.fire();
    }

    async removeAccount(id: string): Promise<void> {
        const accounts = this.getAccounts().filter(a => a.id !== id);
        await this.context.globalState.update(ACCOUNTS_KEY, accounts);
        this._onDidChangeAccounts.fire();
    }

    getAccountById(id: string): PteroAccount | undefined {
        return this.getAccounts().find(a => a.id === id);
    }

    async exportAccounts(): Promise<void> {
        const accounts = this.getAccounts();
        if (accounts.length === 0) {
            vscode.window.showWarningMessage('No accounts to export.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('pterodactyl-accounts.json'),
            filters: { 'JSON Files': ['json'] },
            title: 'Export Pterodactyl Accounts',
        });

        if (!uri) {
            return;
        }

        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            accounts: accounts.map(a => ({
                ...a,
                apiKey: a.apiKey, // include API key in export
            })),
        };

        const content = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');
        await vscode.workspace.fs.writeFile(uri, content);
        vscode.window.showInformationMessage(`Exported ${accounts.length} account(s) successfully.`);
    }

    async importAccounts(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'JSON Files': ['json'] },
            title: 'Import Pterodactyl Accounts',
        });

        if (!uris || uris.length === 0) {
            return;
        }

        try {
            const content = await vscode.workspace.fs.readFile(uris[0]);
            const importData = JSON.parse(Buffer.from(content).toString('utf-8'));

            if (!importData.accounts || !Array.isArray(importData.accounts)) {
                vscode.window.showErrorMessage('Invalid import file format.');
                return;
            }

            const existingAccounts = this.getAccounts();
            const existingIds = new Set(existingAccounts.map(a => a.id));

            let imported = 0;
            let skipped = 0;

            for (const account of importData.accounts) {
                if (!account.id || !account.panelUrl || !account.apiKey) {
                    skipped++;
                    continue;
                }

                if (existingIds.has(account.id)) {
                    // Ask whether to overwrite
                    const choice = await vscode.window.showQuickPick(
                        ['Overwrite', 'Skip', 'Skip All Duplicates'],
                        { placeHolder: `Account "${account.name}" already exists. What to do?` }
                    );

                    if (choice === 'Skip' || !choice) {
                        skipped++;
                        continue;
                    }
                    if (choice === 'Skip All Duplicates') {
                        skipped += importData.accounts.length - imported - skipped;
                        break;
                    }
                    // Overwrite
                    await this.editAccount(account.id, account);
                    imported++;
                } else {
                    await this.addAccount(account as PteroAccount);
                    imported++;
                }
            }

            vscode.window.showInformationMessage(
                `Import complete: ${imported} imported, ${skipped} skipped.`
            );
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to import: ${err.message}`);
        }
    }

    generateId(): string {
        return `ptero_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    dispose(): void {
        this._onDidChangeAccounts.dispose();
    }
}
