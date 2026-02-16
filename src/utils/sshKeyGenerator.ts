import { utils } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export interface SshKeyPair {
    privateKey: string;
    publicKey: string;
}

export class SshKeyGenerator {
    static generateEd25519KeyPair(passphrase?: string): SshKeyPair {
        // Use ssh2 utilities to generate the key pair.
        // This is guaranteed to produce the OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----)
        // which is required by the ssh2 library for Ed25519 authentication.
        const key = utils.generateKeyPairSync('ed25519', passphrase ? {
            passphrase: passphrase,
            cipher: 'aes-256-cbc',
            rounds: 16
        } : {});

        // The 'key' object contains { private, public } strings in OpenSSH/PEM format.
        // Public key from ssh2.utils already includes the comment and is in OpenSSH format.
        // We ensure it has our custom comment for easier identification on the panel.
        const sshPublicKey = key.public.trim() + ' vscode-pterodactyl-auto';

        return {
            privateKey: key.private,
            publicKey: sshPublicKey
        };
    }

    static async savePrivateKey(name: string, privateKey: string): Promise<string> {
        const homeDir = os.homedir();
        const sshDir = path.join(homeDir, '.ssh');

        if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { mode: 0o700 });
        }

        // Sanitize name
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const keyPath = path.join(sshDir, safeName);

        if (fs.existsSync(keyPath)) {
            const answer = await vscode.window.showWarningMessage(
                `SSH key '${safeName}' already exists. Overwrite?`,
                'Yes', 'No'
            );
            if (answer !== 'Yes') {
                throw new Error('Key generation cancelled: File exists.');
            }
        }

        fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
        return keyPath;
    }
}
