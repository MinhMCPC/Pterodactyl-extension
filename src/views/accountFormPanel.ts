import * as vscode from 'vscode';
import { PteroAccount } from '../api/pterodactylClient';
import * as util from 'util';
import { Logger } from '../utils/logger';
import { utils } from 'ssh2';

export class AccountFormPanel {
    private static currentPanel: AccountFormPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly onSubmit: (account: Omit<PteroAccount, 'id'>) => void,
        editAccount?: PteroAccount,
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getHtml(editAccount);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'submit':
                        this.onSubmit(message.data);
                        this.panel.dispose();
                        break;
                    case 'cancel':
                        this.panel.dispose();
                        break;
                    case 'browseKey':
                        const uris = await vscode.window.showOpenDialog({
                            canSelectMany: false,
                            openLabel: 'Select SSH Private Key',
                            title: 'Select SSH Private Key File',
                            filters: { 'All Files': ['*'] },
                        });
                        if (uris && uris.length > 0) {
                            this.panel.webview.postMessage({
                                command: 'setKeyPath',
                                path: uris[0].fsPath,
                            });
                        }
                        break;
                    case 'generateKey':
                        try {
                            const type = message.keyType || 'ed25519';
                            Logger.info(`Starting key generation requested by user (Lib-based). Type: ${type}`);

                            const start = Date.now();
                            const result = await this.generateSshKey(type);
                            const duration = Date.now() - start;

                            Logger.info(`Key pair generated successfully in ${duration}ms`);

                            this.panel.webview.postMessage({
                                command: 'keyGenerated',
                                privateKey: result.privateKey,
                                publicKey: result.publicKey,
                            });
                        } catch (err: any) {
                            Logger.error('Key generation failed', err);
                            vscode.window.showErrorMessage(`Failed to generate key: ${err.message}`);
                        }
                        break;
                }
            },
            null,
            this.disposables
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    private async generateSshKey(type: string): Promise<{ privateKey: string, publicKey: string }> {
        // Use ssh2 library 'utils' to generate keys
        // This ensures compatibility with the library itself and avoids system dependencies
        return new Promise((resolve, reject) => {
            const options: any = {};
            if (type === 'rsa') {
                options.bits = 4096;
            } else if (type === 'ecdsa') {
                options.bits = 521;
            }

            // Map 'ed25519' to what ssh2 expects (it supports 'ed25519' string)

            Logger.debug(`Calling ssh2.utils.generateKeyPair('${type}', ${JSON.stringify(options)})`);

            utils.generateKeyPair(type as any, options, (err: any, keys: any) => {
                if (err) {
                    Logger.error('ssh2.utils.generateKeyPair failed', err);
                    reject(err);
                    return;
                }

                // keys object has .private and .public strings (PEM format)
                resolve({
                    privateKey: keys.private,
                    publicKey: keys.public
                });
            });
        });
    }

    static show(
        extensionUri: vscode.Uri,
        onSubmit: (account: Omit<PteroAccount, 'id'>) => void,
        editAccount?: PteroAccount,
    ): void {
        if (AccountFormPanel.currentPanel) {
            AccountFormPanel.currentPanel.panel.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'pterodactylAccountForm',
            editAccount ? `Edit: ${editAccount.name}` : 'Add Pterodactyl Account',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        AccountFormPanel.currentPanel = new AccountFormPanel(panel, onSubmit, editAccount);
    }

    private getHtml(editAccount?: PteroAccount): string {
        const name = editAccount?.name || '';
        const panelUrl = editAccount?.panelUrl || '';
        const apiKey = editAccount?.apiKey || '';
        const sftpAuthMethod = editAccount?.sftpAuthMethod || 'ssh-key'; // Default to ssh-key now
        const password = editAccount?.password || '';
        const privateKeyPath = editAccount?.privateKeyPath || '';
        const privateKeyData = editAccount?.privateKeyData || '';
        const publicKeyData = editAccount?.publicKeyData || '';
        const username = editAccount?.username || '';
        const authMethod = editAccount?.authMethod || 'api-key';

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pterodactyl Account</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            color: var(--vscode-foreground, #ccc);
            background: var(--vscode-editor-background, #1e1e1e);
            padding: 24px;
            max-width: 560px;
            margin: 0 auto;
        }
        h1 {
            font-size: 20px; font-weight: 600; margin-bottom: 24px;
            display: flex; align-items: center; gap: 8px;
        }
        h1::before { content: '🦕'; font-size: 24px; }
        h3 { font-size: 14px; margin-bottom: 12px; color: var(--vscode-foreground, #ccc); }
        .form-group { margin-bottom: 16px; }
        label {
            display: block; font-size: 13px; font-weight: 500;
            margin-bottom: 6px; color: var(--vscode-foreground, #ccc);
        }
        label .required { color: var(--vscode-errorForeground, #f44); margin-left: 2px; }
        input, select {
            width: 100%; padding: 8px 12px; font-size: 13px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            background: var(--vscode-input-background, #2d2d2d);
            color: var(--vscode-input-foreground, #ccc);
            border-radius: 4px; outline: none; transition: border-color 0.2s;
        }
        input:focus, select:focus { border-color: var(--vscode-focusBorder, #007acc); }
        input::placeholder { color: var(--vscode-input-placeholderForeground, #666); }
        textarea {
            width: 100%; padding: 8px 12px; font-size: 12px;
            font-family: 'Courier New', monospace;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            background: var(--vscode-input-background, #2d2d2d);
            color: var(--vscode-input-foreground, #ccc);
            border-radius: 4px; outline: none; resize: vertical; min-height: 80px;
        }
        textarea:focus { border-color: var(--vscode-focusBorder, #007acc); }
        textarea::placeholder { color: var(--vscode-input-placeholderForeground, #666); }
        .hint { font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-top: 4px; }
        .actions { display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end; }
        button {
            padding: 8px 20px; font-size: 13px; border: none; border-radius: 4px;
            cursor: pointer; font-weight: 500; transition: opacity 0.2s;
        }
        button:hover { opacity: 0.9; }
        button.primary { background: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #fff); }
        button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
        button.browse { width: auto; padding: 8px 14px; margin-left: 8px; flex-shrink: 0; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
        .error { color: var(--vscode-errorForeground, #f44); font-size: 12px; margin-top: 4px; display: none; }
        .divider { border-top: 1px solid var(--vscode-widget-border, #333); margin: 20px 0; }
        .row { display: flex; align-items: center; }
        .row input { flex: 1; }

        /* Radio tabs for SFTP auth */
        .auth-tabs { display: flex; gap: 0; margin-bottom: 12px; }
        .auth-tab {
            padding: 8px 20px; font-size: 13px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            background: transparent; color: var(--vscode-descriptionForeground, #888);
            cursor: pointer; transition: all 0.2s; font-weight: 500;
        }
        .auth-tab:first-child { border-radius: 4px 0 0 4px; }
        .auth-tab:last-child { border-radius: 0 4px 4px 0; border-left: none; }
        .auth-tab.active {
            background: var(--vscode-button-background, #007acc);
            color: var(--vscode-button-foreground, #fff);
            border-color: var(--vscode-button-background, #007acc);
        }
        .auth-content { display: none; }
        .auth-content.active { display: block; }

        /* Generated keys */
        .key-actions { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; }
        .copy-btn { padding: 4px 8px; font-size: 11px; margin-left: auto; }
        .success-msg { color: #4ec9b0; font-size: 11px; margin-left: 8px; display: none; }
        
        .algo-selector { display: flex; gap: 10px; margin-bottom: 8px; }
        .algo-item { cursor: pointer; font-size: 12px; padding: 4px 8px; background: var(--vscode-input-background); border-radius: 3px; border: 1px solid var(--vscode-input-border); }
        .algo-item input { width: auto; margin-right: 6px; vertical-align: middle; }
    </style>
</head>
<body>
    <h1>${editAccount ? 'Edit Account' : 'Add New Account'}</h1>

    <div class="form-group">
        <label>Display Name <span class="required">*</span></label>
        <input type="text" id="name" value="${this.escapeHtml(name)}" placeholder="My Server Panel" />
        <div class="error" id="nameError">Name is required</div>
    </div>

    <div class="form-group">
        <label>Panel URL <span class="required">*</span></label>
        <input type="url" id="panelUrl" value="${this.escapeHtml(panelUrl)}" placeholder="https://panel.example.com" />
        <div class="hint">The URL of your Pterodactyl panel</div>
        <div class="error" id="panelUrlError">Please enter a valid URL</div>
    </div>

    <div class="form-group">
        <label>Username <span class="required">*</span></label>
        <input type="text" id="username" value="${this.escapeHtml(username)}" placeholder="admin" />
        <div class="hint">Your panel login username</div>
        <div class="error" id="usernameError">Username is required</div>
    </div>

    <div class="divider"></div>

    <div class="form-group">
        <label>API Key <span class="required">*</span></label>
        <input type="text" id="apiKey" value="${this.escapeHtml(apiKey)}" placeholder="ptlc_xxxxxxxxxxxxxxxxxxxxxxxxxx" />
        <div class="hint">Panel → Account → API Credentials. Used to list servers.</div>
        <div class="error" id="apiKeyError">API key is required</div>
    </div>

    <div style="display:none">
        <select id="authMethod"><option value="api-key" selected>API Key</option></select>
    </div>

    <div class="divider"></div>

    <h3>🔐 SFTP Authentication</h3>

    <div class="auth-tabs">
        <button class="auth-tab ${sftpAuthMethod === 'password' ? 'active' : ''}" onclick="switchSftpAuth('password')" type="button">🔑 Password</button>
        <button class="auth-tab ${sftpAuthMethod === 'ssh-key' ? 'active' : ''}" onclick="switchSftpAuth('ssh-key')" type="button">🔒 SSH Key</button>
    </div>

    <!-- Password auth -->
    <div id="authPassword" class="auth-content ${sftpAuthMethod === 'password' ? 'active' : ''}">
        <div class="form-group">
            <label>Panel Password <span class="required">*</span></label>
            <input type="password" id="password" value="${this.escapeHtml(password)}" placeholder="Your panel login password" />
            <div class="hint">Same password you use to log into the web panel.</div>
            <div class="error" id="passwordError">Password is required</div>
        </div>
    </div>

    <!-- SSH Key auth -->
    <div id="authSshKey" class="auth-content ${sftpAuthMethod === 'ssh-key' ? 'active' : ''}">
        
        <div class="form-group">
             <label>Key Type</label>
             <select id="keyType" style="margin-bottom: 8px;">
                 <option value="ed25519" selected>ED25519 (Fast & Secure)</option>
                 <option value="rsa">RSA (4096-bit - Legacy Compatible)</option>
                 <option value="ecdsa">ECDSA (521-bit)</option>
             </select>
        </div>

        <div class="key-actions">
            <button class="secondary" onclick="generateKey()" type="button" id="genBtn">⚡ Generate Key Pair</button>
            <div class="hint" style="margin-left:8px">Used library (ssh2) generation</div>
        </div>

        <div class="form-group">
            <label>Private Key</label>
            <textarea id="privateKeyData" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----...">${this.escapeHtml(privateKeyData)}</textarea>
            <div class="hint">Paste your private key here, or use Generate above.</div>
            <div class="key-actions" style="margin-top:8px">
                <button class="browse" onclick="browseKey()" type="button">📂 Browse File...</button>
                <input type="text" id="privateKeyPath" value="${this.escapeHtml(privateKeyPath)}" placeholder="Optional: Path to key file" readonly style="flex:1" />
            </div>
        </div>

        <div class="form-group">
            <label>Public Key (Copy to Panel)</label>
            <textarea id="publicKeyData" rows="3" readonly placeholder="ssh-ed25519 ...">${this.escapeHtml(publicKeyData)}</textarea>
            <div class="key-actions" style="justify-content:flex-end">
                <span class="success-msg" id="copySuccess">✅ Copied!</span>
                <button class="copy-btn" onclick="copyPubKey()" type="button">📋 Copy to Clipboard</button>
            </div>
        </div>

        <div class="error" id="sshKeyError">SSH private key is required</div>
    </div>

    <div class="actions">
        <button class="secondary" onclick="cancel()">Cancel</button>
        <button class="primary" onclick="submit()">
            ${editAccount ? '💾 Save Changes' : '➕ Add Account'}
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentSftpAuth = '${sftpAuthMethod}';

        // Restore form state - simplistic for now
        const previousState = vscode.getState();
        if (previousState) {
            Object.keys(previousState).forEach(key => {
                const el = document.getElementById(key);
                if (el) { el.value = previousState[key]; }
            });
            if (previousState.sftpAuthMethod) {
                switchSftpAuth(previousState.sftpAuthMethod);
            }
        }

        // Listen for messages
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'setKeyPath') {
                document.getElementById('privateKeyPath').value = msg.path;
                saveState();
            }
            if (msg.command === 'keyGenerated') {
                document.getElementById('privateKeyData').value = msg.privateKey;
                document.getElementById('publicKeyData').value = msg.publicKey;
                document.getElementById('genBtn').textContent = '✅ Key Generated';
                setTimeout(() => { document.getElementById('genBtn').textContent = '⚡ Generate Key Pair'; }, 2000);
                saveState();
            }
        });

        // Auto-save
        document.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('input', saveState);
            el.addEventListener('change', saveState);
        });

        function saveState() {
            const state = {
                sftpAuthMethod: currentSftpAuth,
                name: document.getElementById('name').value,
                panelUrl: document.getElementById('panelUrl').value,
                apiKey: document.getElementById('apiKey').value,
                password: document.getElementById('password').value,
                privateKeyPath: document.getElementById('privateKeyPath').value,
                privateKeyData: document.getElementById('privateKeyData').value,
                publicKeyData: document.getElementById('publicKeyData').value,
                username: document.getElementById('username').value,
                authMethod: document.getElementById('authMethod').value,
                keyType: document.getElementById('keyType').value,
            };
            vscode.setState(state);
        }

        function showError(id, show) {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? 'block' : 'none';
        }

        function switchSftpAuth(method) {
            currentSftpAuth = method;
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-content').forEach(c => c.classList.remove('active'));
            if (method === 'password') {
                document.querySelector('.auth-tab:first-child').classList.add('active');
                document.getElementById('authPassword').classList.add('active');
            } else {
                document.querySelector('.auth-tab:last-child').classList.add('active');
                document.getElementById('authSshKey').classList.add('active');
            }
            saveState();
        }

        function browseKey() {
            vscode.postMessage({ command: 'browseKey' });
        }

        function generateKey() {
            const type = document.getElementById('keyType').value;
            const btn = document.getElementById('genBtn');
            btn.textContent = '⏳ Generating ' + type.toUpperCase() + '...';
            vscode.postMessage({ command: 'generateKey', keyType: type });
        }

        function copyPubKey() {
            const ta = document.getElementById('publicKeyData');
            ta.select();
            document.execCommand('copy');
            const msg = document.getElementById('copySuccess');
            msg.style.display = 'inline';
            setTimeout(() => { msg.style.display = 'none'; }, 2000);
        }

        function submit() {
            const name = document.getElementById('name').value.trim();
            const panelUrl = document.getElementById('panelUrl').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            const password = document.getElementById('password').value;
            const privateKeyPath = document.getElementById('privateKeyPath').value.trim();
            const privateKeyData = document.getElementById('privateKeyData').value.trim();
            const publicKeyData = document.getElementById('publicKeyData').value.trim();
            const username = document.getElementById('username').value.trim();
            const authMethod = document.getElementById('authMethod').value;
            const keyType = document.getElementById('keyType').value;

            let valid = true;

            if (!name) { showError('nameError', true); valid = false; } else { showError('nameError', false); }
            if (!panelUrl) { showError('panelUrlError', true); valid = false; }
            try { new URL(panelUrl); showError('panelUrlError', false); } catch { showError('panelUrlError', true); valid = false; }
            if (!apiKey) { showError('apiKeyError', true); valid = false; } else { showError('apiKeyError', false); }
            if (!username) { showError('usernameError', true); valid = false; } else { showError('usernameError', false); }

            if (currentSftpAuth === 'password') {
                if (!password) { showError('passwordError', true); valid = false; } else { showError('passwordError', false); }
                showError('sshKeyError', false);
            } else {
                if (!privateKeyPath && !privateKeyData) { showError('sshKeyError', true); valid = false; } else { showError('sshKeyError', false); }
                showError('passwordError', false);
            }

            if (!valid) return;

            vscode.postMessage({
                command: 'submit',
                data: {
                    name,
                    panelUrl: panelUrl.replace(/\\/+$/, ''),
                    apiKey,
                    sftpAuthMethod: currentSftpAuth,
                    password: currentSftpAuth === 'password' ? password : '',
                    privateKeyPath: currentSftpAuth === 'ssh-key' ? privateKeyPath : '',
                    privateKeyData: currentSftpAuth === 'ssh-key' ? privateKeyData : '',
                    publicKeyData, // Save public key for reference
                    username,
                    authMethod,
                }
            });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { submit(); }
            if (e.key === 'Escape') { cancel(); }
        });
    </script>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private dispose(): void {
        AccountFormPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            d?.dispose();
        }
    }
}
