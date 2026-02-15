import * as vscode from 'vscode';
import { AccountManager } from './accounts/accountManager';
import { PterodactylClient, PteroAccount } from './api/pterodactylClient';
import { ServerTreeProvider, ServerTreeItem } from './views/serverTreeProvider';
import { PterodactylFileSystemProvider } from './filesystem/pterodactylFileSystemProvider';
import { AccountFormPanel } from './views/accountFormPanel';
import { SftpClient } from './sftp/sftpClient';
import { TerminalManager } from './terminal/terminalManager';

let accountManager: AccountManager;
let serverTreeProvider: ServerTreeProvider;
let fileSystemProvider: PterodactylFileSystemProvider;
let terminalManager: TerminalManager;
let extensionContext: vscode.ExtensionContext;

import { Logger } from './utils/logger';

export function activate(context: vscode.ExtensionContext) {
    Logger.initialize();
    Logger.info('Extension activating...');

    extensionContext = context;

    // Initialize managers
    accountManager = new AccountManager(context);
    serverTreeProvider = new ServerTreeProvider(accountManager);
    fileSystemProvider = new PterodactylFileSystemProvider();
    terminalManager = new TerminalManager();

    // Register FileSystemProvider for ptero:// scheme
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('ptero', fileSystemProvider, {
            isCaseSensitive: true,
            isReadonly: false,
        })
    );

    // Register TreeView
    const treeView = vscode.window.createTreeView('pterodactylServers', {
        treeDataProvider: serverTreeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('pterodactyl.addAccount', () => openAddAccountForm()),
        vscode.commands.registerCommand('pterodactyl.editAccount', (item?: ServerTreeItem) => openEditAccountForm(item)),
        vscode.commands.registerCommand('pterodactyl.removeAccount', (item?: ServerTreeItem) => removeAccount(item)),
        vscode.commands.registerCommand('pterodactyl.refreshServers', () => refreshServers()),
        vscode.commands.registerCommand('pterodactyl.connectServer', (item?: ServerTreeItem) => connectToServer(item)),
        vscode.commands.registerCommand('pterodactyl.disconnectServer', (item?: ServerTreeItem) => disconnectServer(item)),
        vscode.commands.registerCommand('pterodactyl.reconnectServer', (item?: ServerTreeItem) => reconnectServer(item)),
        vscode.commands.registerCommand('pterodactyl.exportData', () => accountManager.exportAccounts()),
        vscode.commands.registerCommand('pterodactyl.importData', () => accountManager.importAccounts()),
        vscode.commands.registerCommand('pterodactyl.showSftpLog', () => SftpClient.showDebugLog()),
        vscode.commands.registerCommand('pterodactyl.openTerminal', (item?: ServerTreeItem) => openTerminal(item)),

        // Power Actions
        vscode.commands.registerCommand('pterodactyl.startServer', (item?: ServerTreeItem) => sendPowerSignal(item, 'start')),
        vscode.commands.registerCommand('pterodactyl.restartServer', (item?: ServerTreeItem) => sendPowerSignal(item, 'restart')),
        vscode.commands.registerCommand('pterodactyl.stopServer', (item?: ServerTreeItem) => sendPowerSignal(item, 'stop')),
        vscode.commands.registerCommand('pterodactyl.killServer', (item?: ServerTreeItem) => sendPowerSignal(item, 'kill')),
    );

    // Auto-restore connections
    restoreConnections();

    Logger.info('Pterodactyl SFTP extension activated');
}

function openAddAccountForm(): void {
    AccountFormPanel.show(
        extensionContext.extensionUri,
        async (data) => {
            // Test connection
            const success = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Testing connection...',
                    cancellable: false,
                },
                async () => {
                    const client = new PterodactylClient(data.panelUrl, data.apiKey);
                    return client.testConnection();
                }
            );

            if (!success) {
                const proceed = await vscode.window.showWarningMessage(
                    'Could not connect to the panel. Save account anyway?',
                    'Save', 'Cancel'
                );
                if (proceed !== 'Save') { return; }
            }

            const account: PteroAccount = {
                id: accountManager.generateId(),
                ...data,
            };

            await accountManager.addAccount(account);
            vscode.window.showInformationMessage(`Account "${data.name}" added successfully!`);
        }
    );
}

async function openEditAccountForm(item?: ServerTreeItem): Promise<void> {
    let account: PteroAccount | undefined;

    if (item?.account) {
        account = item.account;
    } else {
        const accounts = accountManager.getAccounts();
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('No accounts to edit.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            accounts.map(a => ({ label: a.name, description: a.panelUrl, account: a })),
            { placeHolder: 'Select account to edit' }
        );
        if (!picked) { return; }
        account = picked.account;
    }

    if (!account) { return; }

    const editId = account.id;
    AccountFormPanel.show(
        extensionContext.extensionUri,
        async (data) => {
            await accountManager.editAccount(editId, data);
            vscode.window.showInformationMessage(`Account "${data.name}" updated successfully!`);
        },
        account
    );
}

async function removeAccount(item?: ServerTreeItem): Promise<void> {
    let account: PteroAccount | undefined;

    if (item?.account) {
        account = item.account;
    } else {
        const accounts = accountManager.getAccounts();
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('No accounts to remove.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            accounts.map(a => ({ label: a.name, description: a.panelUrl, account: a })),
            { placeHolder: 'Select account to remove' }
        );
        if (!picked) { return; }
        account = picked.account;
    }

    if (!account) { return; }

    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to remove account "${account.name}"?`,
        { modal: true },
        'Remove'
    );

    if (confirm === 'Remove') {
        await accountManager.removeAccount(account.id);
        vscode.window.showInformationMessage(`Account "${account.name}" removed.`);
    }
}

function refreshServers(): void {
    serverTreeProvider.clearCache();
    fileSystemProvider.clearCache();
    serverTreeProvider.refresh();
    vscode.window.showInformationMessage('Server list refreshed.');
}

async function connectToServer(item?: ServerTreeItem, silent: boolean = false): Promise<void> {
    try {
        if (!item?.server || !item?.account) {
            vscode.window.showErrorMessage('Please select a server from the tree to connect.');
            return;
        }

        const server = item.server;
        const account = item.account;
        Logger.info(`Connecting to server: ${server.name} (${server.identifier})`);

        if (server.is_suspended) {
            vscode.window.showErrorMessage(`Server "${server.name}" is suspended and cannot be accessed.`);
            return;
        }

        if (server.is_installing) {
            vscode.window.showWarningMessage(`Server "${server.name}" is still installing.`);
            return;
        }

        // Get SFTP connection details from server
        const sftpHost = server.sftp_details.ip;
        const sftpPort = server.sftp_details.port || 2022;

        Logger.info(`SFTP Connect: ${server.name} -> ${sftpHost}:${sftpPort}`);

        if (!sftpHost) {
            vscode.window.showErrorMessage(`No SFTP host found for server "${server.name}". Check console for details.`);
            return;
        }

        // Register the SFTP connection
        try {
            fileSystemProvider.registerConnection(
                server.identifier,
                account,
                server.name,
                sftpHost,
                sftpPort
            );
        } catch (err: any) {
            Logger.error('Failed to register SFTP connection', err);
            vscode.window.showErrorMessage(`Failed to initialize connection: ${err.message}`);
            return;
        }

        // Create the ptero:// URI and add as workspace folder
        const uri = vscode.Uri.parse(`ptero://${server.identifier}/`);
        const folderName = `🦕 ${server.name}`;

        // Check if already added
        const existingFolder = vscode.workspace.workspaceFolders?.find(
            f => f.uri.scheme === 'ptero' && f.uri.authority === server.identifier
        );

        if (existingFolder) {
            vscode.window.showInformationMessage(`Already connected to "${server.name}".`);
            vscode.commands.executeCommand('revealInExplorer', uri);
            return;
        }

        const added = vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length || 0,
            0,
            { uri, name: folderName }
        );

        if (added) {
            if (!silent) {
                vscode.window.showInformationMessage(
                    `Connected to "${server.name}" via SFTP (${sftpHost}:${sftpPort})! Browse files in the Explorer.`
                );
            }
        } else {
            Logger.warn(`Failed to add workspace folder for ${server.name}`);
            vscode.window.showErrorMessage(`Failed to connect to "${server.name}".`);
        }
    } catch (err: any) {
        Logger.error('Critical error in connectToServer', err);
        vscode.window.showErrorMessage(`An error occurred while connecting: ${err.message}`);
    }
}

async function disconnectServer(item?: ServerTreeItem): Promise<void> {
    let identifier: string | undefined;
    let serverName: string = '';

    if (item?.server) {
        identifier = item.server.identifier;
        serverName = item.server.name;
    } else {
        // Find active connection from workspace
        const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'ptero') || [];
        if (folders.length === 0) {
            vscode.window.showErrorMessage('No Pterodactyl server connected.');
            return;
        }

        if (folders.length === 1) {
            identifier = folders[0].uri.authority;
            serverName = folders[0].name.replace('🦕 ', '');
        } else {
            const picked = await vscode.window.showQuickPick(
                folders.map(f => ({ label: f.name, description: f.uri.authority, uri: f.uri })),
                { placeHolder: 'Select server to disconnect' }
            );
            if (!picked) return;
            identifier = picked.description;
            serverName = picked.label.replace('🦕 ', '');
        }
    }

    if (!identifier) return;

    // Remove workspace folder
    const folder = vscode.workspace.workspaceFolders?.find(
        f => f.uri.scheme === 'ptero' && f.uri.authority === identifier
    );

    if (folder) {
        const index = vscode.workspace.workspaceFolders!.indexOf(folder);
        vscode.workspace.updateWorkspaceFolders(index, 1);
    }

    // Disconnect SFTP
    await fileSystemProvider.disconnectServer(identifier);
    vscode.window.showInformationMessage(`Disconnected from "${serverName}".`);
}

async function reconnectServer(item?: ServerTreeItem): Promise<void> {
    let identifier: string | undefined;
    let serverName: string = '';

    // If called from tree view
    if (item?.server && item?.account) {
        identifier = item.server.identifier;
        serverName = item.server.name;
    } else {
        // Called from command palette
        const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'ptero') || [];
        if (folders.length === 0) {
            vscode.window.showErrorMessage('No Pterodactyl server connected to reconnect.');
            return;
        }

        let targetFolder: vscode.WorkspaceFolder;
        if (folders.length === 1) {
            targetFolder = folders[0];
        } else {
            const picked = await vscode.window.showQuickPick(
                folders.map(f => ({ label: f.name, description: f.uri.authority, folder: f })),
                { placeHolder: 'Select server to reconnect' }
            );
            if (!picked) return;
            targetFolder = picked.folder;
        }

        identifier = targetFolder.uri.authority;
        serverName = targetFolder.name.replace('🦕 ', '');
    }

    if (!identifier) return;

    Logger.info(`Reconnecting to ${serverName} (${identifier})...`);

    try {
        await fileSystemProvider.reconnect(identifier);
        vscode.window.showInformationMessage(`Reconnected to "${serverName}" successfully.`);
    } catch (err: any) {
        // If no active connection found (e.g. after reload), try to find server in tree
        if (err.message.includes('No active connection')) {
            Logger.info(`No active connection state for ${identifier}, attempting to discover from tree...`);

            // Try to find the server
            let treeItem = await serverTreeProvider.findServer(identifier);

            if (!treeItem) {
                // Try refreshing if not found (maybe first load)
                serverTreeProvider.refresh();
                // small delay for refresh? findServer actually triggers fetch if needed for accounts
                // But wait, findServer iterates accounts.
                // let's try finding again just in case async timing
            }

            // findServer implementation already fetches if not in cache! 
            // So if it returns undefined, it's really not found.

            if (treeItem) {
                await connectToServer(treeItem);
                return;
            } else {
                Logger.error(`Could not find server ${identifier} in any configured account.`);
                vscode.window.showErrorMessage(`Could not reconnect: Server not found in your accounts. Please check your configuration.`);
            }
        } else {
            Logger.error('Failed to reconnect', err);
            vscode.window.showErrorMessage(`Failed to reconnect to "${serverName}": ${err.message}`);
        }
    }
}

async function openTerminal(item?: ServerTreeItem): Promise<void> {
    if (!item?.server || !item?.account) {
        vscode.window.showErrorMessage('Please select a server to open terminal.');
        return;
    }

    const server = item.server;
    const client = new PterodactylClient(item.account.panelUrl, item.account.apiKey);

    try {
        await terminalManager.openTerminal(
            server.identifier,
            server.name,
            server.uuid,
            client
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to open terminal: ${err.message}`);
    }
}

async function restoreConnections() {
    const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'ptero') || [];
    if (folders.length === 0) return;

    Logger.info(`Found ${folders.length} Pterodactyl workspace folders to restore.`);

    // Wait briefly for AccountManager to initialize if needed
    // But it's synchronous read.
    // ServerTreeProvider logic handles fetching.

    for (const folder of folders) {
        const identifier = folder.uri.authority;
        Logger.info(`Restoring connection for ${folder.name} (${identifier})...`);
        try {
            // Finding server might take a moment if it needs to fetch from API
            const item = await serverTreeProvider.findServer(identifier);
            if (item) {
                await connectToServer(item, true); // Silent mode
            } else {
                Logger.warn(`Could not find server info for ${identifier} to restore.`);
            }
        } catch (err) {
            Logger.error(`Failed to restore ${folder.name}`, err);
        }
    }
}

async function sendPowerSignal(item: ServerTreeItem | undefined, signal: 'start' | 'stop' | 'restart' | 'kill'): Promise<void> {
    if (!item || !item.server || !item.account) { return; }

    const actionName = signal.charAt(0).toUpperCase() + signal.slice(1);

    // Confirm Kill
    if (signal === 'kill') {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to KILL server "${item.server.name}"? This may cause data loss.`,
            'Yes, Kill', 'Cancel'
        );
        if (confirm !== 'Yes, Kill') return;
    }

    try {
        const client = new PterodactylClient(item.account.panelUrl, item.account.apiKey);
        await client.sendPowerAction(item.server.uuid, signal);
        vscode.window.showInformationMessage(`Signal "${signal}" sent to "${item.server.name}".`);

        // Refresh status after duplicate delay
        setTimeout(() => {
            // We can't easily refresh just one item, refresh provider
            serverTreeProvider.refresh();
        }, 2000);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to ${signal} server: ${err.message}`);
    }
}

export function deactivate() {
    accountManager?.dispose();
    serverTreeProvider?.dispose();
    fileSystemProvider?.dispose();
    terminalManager?.dispose();
}
