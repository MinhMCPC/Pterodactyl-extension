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
        :root {
            --ptero-bg: #1e1e3f;
            --ptero-panel: #2d2d55;
            --ptero-input: #151529;
            --ptero-border: #434370;
            --ptero-primary: #6c5ce7;
            --ptero-primary-hover: #5b4cc4;
            --ptero-text: #e1e1e6;
            --ptero-text-secondary: #a0a0b0;
            --ptero-danger: #ff4757;
            --ptero-success: #2ecc71;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: var(--ptero-text);
            background: var(--ptero-bg);
            padding: 40px 24px;
            display: flex;
            justify-content: center;
            min-height: 100vh;
        }

        .container {
            width: 100%;
            max-width: 600px;
            background: var(--ptero-panel);
            padding: 32px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            border: 1px solid var(--ptero-border);
        }

        h1 {
            font-size: 24px; 
            font-weight: 700; 
            margin-bottom: 28px;
            color: #fff;
            display: flex; 
            align-items: center; 
            gap: 12px;
            border-bottom: 2px solid var(--ptero-border);
            padding-bottom: 16px;
        }
        h1::before { content: '🦕'; font-size: 28px; }

        h3 { 
            font-size: 15px; 
            font-weight: 600;
            margin: 24px 0 16px; 
            color: #fff; 
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .form-group { margin-bottom: 20px; }
        
        label {
            display: block; 
            font-size: 13px; 
            font-weight: 600;
            margin-bottom: 8px; 
            color: var(--ptero-text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        label .required { color: var(--ptero-danger); margin-left: 2px; }

        input, select, textarea {
            width: 100%; 
            padding: 12px 16px; 
            font-size: 14px;
            border: 1px solid var(--ptero-border);
            background: var(--ptero-input);
            color: #fff;
            border-radius: 8px; 
            outline: none; 
            transition: all 0.2s;
        }

        input:focus, select:focus, textarea:focus { 
            border-color: var(--ptero-primary);
            box-shadow: 0 0 0 2px rgba(108, 92, 231, 0.2); 
        }

        textarea {
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            min-height: 100px;
            line-height: 1.5;
        }

        .hint { 
            font-size: 12px; 
            color: var(--ptero-text-secondary); 
            margin-top: 6px; 
        }

        .actions { 
            display: flex; 
            gap: 12px; 
            margin-top: 32px; 
            padding-top: 24px;
            border-top: 1px solid var(--ptero-border);
            justify-content: flex-end; 
        }

        button {
            padding: 10px 24px; 
            font-size: 14px; 
            border: none; 
            border-radius: 6px;
            cursor: pointer; 
            font-weight: 600; 
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        button:hover { transform: translateY(-1px); }
        button:active { transform: translateY(0); }

        button.primary { 
            background: var(--ptero-primary); 
            color: #fff; 
            box-shadow: 0 4px 12px rgba(108, 92, 231, 0.3);
        }
        button.primary:hover { background: var(--ptero-primary-hover); }

        button.secondary { 
            background: transparent; 
            border: 1px solid var(--ptero-border);
            color: var(--ptero-text); 
        }
        button.secondary:hover { 
            background: rgba(255,255,255,0.05); 
            border-color: #555;
        }

        button.small-btn {
            padding: 6px 12px;
            font-size: 12px;
            background: #333;
            color: #ccc;
        }

        /* Toggle Switch */
        .toggle-container {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255,255,255,0.03);
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid var(--ptero-border);
            margin-bottom: 16px;
            cursor: pointer;
        }
        .toggle-container:hover { background: rgba(255,255,255,0.05); }

        .toggle-label {
            display: flex;
            flex-direction: column;
        }
        .toggle-title { font-weight: 600; color: #fff; font-size: 14px; }
        .toggle-desc { font-size: 12px; color: var(--ptero-text-secondary); margin-top: 2px; }

        .switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
        }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #333;
            transition: .3s;
            border-radius: 24px;
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .3s;
            border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--ptero-primary); }
        input:checked + .slider:before { transform: translateX(20px); }

        /* Auth Tabs */
        .auth-tabs { 
            display: flex; 
            background: var(--ptero-input);
            padding: 4px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid var(--ptero-border);
        }
        .auth-tab {
            flex: 1;
            padding: 8px;
            text-align: center;
            cursor: pointer;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            color: var(--ptero-text-secondary);
            transition: all 0.2s;
            border: none;
            background: transparent;
        }
        .auth-tab.active {
            background: var(--ptero-primary);
            color: #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        .auth-content { display: none; animation: fadeIn 0.3s ease; }
        .auth-content.active { display: block; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

        .error { 
            color: var(--ptero-danger); 
            font-size: 12px; 
            margin-top: 6px; 
            display: none; 
            font-weight: 500;
        }

        /* Responsive Fixes */
        @media (max-width: 600px) {
            body { padding: 16px; }
            .container { padding: 20px; }
        }

        .key-upload-info {
            background: rgba(46, 204, 113, 0.1);
            border: 1px solid rgba(46, 204, 113, 0.3);
            color: #2ecc71;
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
            margin-top: 10px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${editAccount ? 'Edit Account' : 'Add New Account'}</h1>

        <div class="form-group">
            <label>Display Name <span class="required">*</span></label>
            <input type="text" id="name" value="${this.escapeHtml(name)}" placeholder="My Server Panel" />
            <div class="error" id="nameError">Name is required</div>
        </div>

        <div class="form-group">
            <label>Panel URL <span class="required">*</span></label>
            <input type="url" id="panelUrl" value="${this.escapeHtml(panelUrl)}" placeholder="https://panel.example.com" />
            <div class="hint">The URL of your Pterodactyl panel home page</div>
            <div class="error" id="panelUrlError">Please enter a valid URL</div>
        </div>

        <div class="form-group">
            <label>Username <span class="required">*</span></label>
            <input type="text" id="username" value="${this.escapeHtml(username)}" placeholder="admin" />
            <div class="hint">Your panel login username (for reference)</div>
            <div class="error" id="usernameError">Username is required</div>
        </div>

        <h3>🔐 API Credentials</h3>
        <div class="form-group">
            <label>API Key <span class="required">*</span></label>
            <input type="password" id="apiKey" value="${this.escapeHtml(apiKey)}" placeholder="ptlc_xxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <div class="hint">Create this in Panel → Account → API Credentials</div>
            <div class="error" id="apiKeyError">API key is required</div>
        </div>

        <div style="display:none">
            <select id="authMethod"><option value="api-key" selected>API Key</option></select>
        </div>

        <h3>🚀 SFTP Authentication</h3>

        <div class="auth-tabs">
            <button class="auth-tab ${sftpAuthMethod === 'ssh-key' ? 'active' : ''}" onclick="switchSftpAuth('ssh-key')" type="button">SSH Key (Recommended)</button>
            <button class="auth-tab ${sftpAuthMethod === 'password' ? 'active' : ''}" onclick="switchSftpAuth('password')" type="button">Password</button>
        </div>

        <!-- SSH Key auth -->
        <div id="authSshKey" class="auth-content ${sftpAuthMethod === 'ssh-key' ? 'active' : ''}">
            
            ${!editAccount ? `
            <div class="toggle-container" onclick="toggleAutoKey()">
                <div class="toggle-label">
                    <span class="toggle-title">Auto-configure SSH Key</span>
                    <span class="toggle-desc">Generate new key and upload to panel automatically</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="autoKey">
                    <span class="slider"></span>
                </label>
            </div>
            ` : ''}

            <div id="manualKeySection">
                <div class="form-group">
                    <label>Private Key Path</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="privateKeyPath" value="${this.escapeHtml(privateKeyPath)}" placeholder="C:/Users/You/.ssh/id_rsa" />
                        <button class="secondary small-btn" onclick="browseKey()" type="button">Browse...</button>
                    </div>
                    <div class="hint">Path to your local private key file</div>
                </div>

                <div class="form-group">
                    <label>Or Paste Private Key</label>
                    <textarea id="privateKeyData" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----...">${this.escapeHtml(privateKeyData)}</textarea>
                    <div style="margin-top: 8px;">
                        <button class="secondary small-btn" onclick="generateKey()" type="button">✨ Generate Key Pair</button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Public Key (Optional)</label>
                    <textarea id="publicKeyData" placeholder="ssh-ed25519 ..." style="min-height:60px">${this.escapeHtml(publicKeyData)}</textarea>
                </div>
            </div>

            <div id="autoKeyInfo" class="key-upload-info">
                <strong>✨ Auto-Setup Enabled:</strong><br>
                When you click "Add Account", we will generate a secure Ed25519 key pair, save it to your <code>.ssh</code> folder, and upload the public key to this Pterodactyl account automatically.
            </div>

            <div class="error" id="sshKeyError">SSH private key path or content is required</div>
        </div>

        <!-- Password auth -->
        <div id="authPassword" class="auth-content ${sftpAuthMethod === 'password' ? 'active' : ''}">
            <div class="form-group">
                <label>Panel Password</label>
                <input type="password" id="password" value="${this.escapeHtml(password)}" placeholder="Your panel login password" />
                <div class="hint">The password you use to log into the web panel</div>
                <div class="error" id="passwordError">Password is required</div>
            </div>
        </div>

        <div class="actions">
            <button class="secondary" onclick="cancel()">Cancel</button>
            <button class="primary" onclick="submit()">
                ${editAccount ? 'Save Changes' : 'Add Account'}
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentSftpAuth = '${sftpAuthMethod}';

        // Listen for messages
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'setKeyPath') {
                document.getElementById('privateKeyPath').value = msg.path;
            } else if (msg.command === 'keyGenerated') {
                document.getElementById('privateKeyData').value = msg.privateKey;
                document.getElementById('publicKeyData').value = msg.publicKey;
                // Switch to manual mode so they see it
                document.getElementById('manualKeySection').style.display = 'block';
                document.getElementById('autoKeyInfo').style.display = 'none';
                if (document.getElementById('autoKey')) document.getElementById('autoKey').checked = false;
            }
        });

        function switchSftpAuth(method) {
            currentSftpAuth = method;
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-content').forEach(c => c.classList.remove('active'));
            
            if (method === 'password') {
                document.querySelectorAll('.auth-tab')[1].classList.add('active');
                document.getElementById('authPassword').classList.add('active');
            } else {
                document.querySelectorAll('.auth-tab')[0].classList.add('active');
                document.getElementById('authSshKey').classList.add('active');
            }
        }

        function toggleAutoKey() {
            const checkbox = document.getElementById('autoKey');
            // Toggle usually happens by label click, but if we need manual:
            // checkbox.checked = !checkbox.checked;
            // The click on container might trigger double toggle if not careful.
            
            // Actually, because the input is inside the label which is inside container, 
            // clicking container might not trigger input change if we handle onclick.
            // Let's rely on CSS/HTML structure or check state.
            
            setTimeout(() => {
                const auto = checkbox.checked;
                document.getElementById('manualKeySection').style.display = auto ? 'none' : 'block';
                document.getElementById('autoKeyInfo').style.display = auto ? 'block' : 'none';
            }, 50);
        }
        
        // Ensure manual toggle works if user clicks switch directly
        document.getElementById('autoKey')?.addEventListener('change', toggleAutoKey);

        function browseKey() {
            vscode.postMessage({ command: 'browseKey' });
        }

        function generateKey() {
            vscode.postMessage({ command: 'generateKey', keyType: 'ed25519' });
        }

        function submit() {
            const name = document.getElementById('name').value.trim();
            const panelUrl = document.getElementById('panelUrl').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            const password = document.getElementById('password').value;
            const privateKeyPath = document.getElementById('privateKeyPath').value.trim();
            const privateKeyData = document.getElementById('privateKeyData').value.trim();
            const publicKeyData = document.getElementById('publicKeyData')?.value.trim() || '';
            const username = document.getElementById('username').value.trim();
            const authMethod = document.getElementById('authMethod').value;
            
            // Auto Key flag
            const autoKeyEl = document.getElementById('autoKey');
            const createSshKey = autoKeyEl ? autoKeyEl.checked : false;

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
                // If auto key is OFF, check for manual key
                if (!createSshKey && !privateKeyPath && !privateKeyData) { 
                    showError('sshKeyError', true); 
                    valid = false; 
                } else { 
                    showError('sshKeyError', false); 
                }
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
                    privateKeyPath: (currentSftpAuth === 'ssh-key' && !createSshKey) ? privateKeyPath : '',
                    privateKeyData: (currentSftpAuth === 'ssh-key' && !createSshKey) ? privateKeyData : '',
                    publicKeyData,
                    username,
                    authMethod,
                    createSshKey: (currentSftpAuth === 'ssh-key' && createSshKey)
                }
            });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        function showError(id, show) {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? 'block' : 'none';
        }

        document.addEventListener('keydown', (e) => {
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
