import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export interface PteroAccount {
    id: string;
    name: string;
    panelUrl: string;
    apiKey: string;
    sftpAuthMethod: 'password' | 'ssh-key'; // SFTP authentication method
    password: string; // Panel login password (for SFTP password auth)
    privateKeyPath: string; // Path to SSH private key file
    privateKeyData: string; // Pasted/generated SSH private key content
    publicKeyData?: string; // Generated SSH public key content (optional, added for reference)
    username: string;
    authMethod: 'api-key' | 'cookie';
}

export interface PteroServer {
    id: string;
    uuid: string;
    identifier: string;
    name: string;
    description: string;
    status: string | null;
    node: string;
    is_suspended: boolean;
    is_installing: boolean;
    sftp_details: {
        ip: string;
        port: number;
    };
    limits: {
        memory: number; // MB
        disk: number;   // MB
        cpu: number;    // %
    };
    allocation: {
        ip: string;
        port: number;
    };
    docker_image: string;
    usage?: {
        memory_bytes: number;
        cpu_absolute: number;
        disk_bytes: number;
        network_rx_bytes: number;
        network_tx_bytes: number;
        uptime: number; // ms
    };
}

export interface PteroResourceUsage {
    current_state: string;
    resources: {
        memory_bytes: number;
        cpu_absolute: number;
        disk_bytes: number;
        network_rx_bytes: number;
        network_tx_bytes: number;
        uptime: number;
    };
}

export interface PteroFileObject {
    name: string;
    mode: string;
    mode_bits: string;
    size: number;
    is_file: boolean;
    is_symlink: boolean;
    mimetype: string;
    created_at: string;
    modified_at: string;
}

export class PterodactylClient {
    public readonly panelUrl: string;
    private apiKey: string;

    constructor(panelUrl: string, apiKey: string) {
        this.panelUrl = panelUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
    }

    private async request<T>(method: string, path: string, body?: any, rawBody?: string): Promise<T> {
        const url = `${this.panelUrl}${path}`;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
        };

        let fetchBody: string | undefined;

        if (rawBody !== undefined) {
            headers['Content-Type'] = 'text/plain';
            fetchBody = rawBody;
        } else if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            fetchBody = JSON.stringify(body);
        }

        const response = await fetch(url, {
            method,
            headers,
            body: fetchBody,
        });

        Logger.debug(`API ${method} ${path} -> ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Pterodactyl API Error ${response.status}: ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.errors && errorJson.errors.length > 0) {
                    errorMessage = errorJson.errors.map((e: any) => e.detail || e.message).join(', ');
                }
            } catch {
                if (errorText) {
                    errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
            }
            Logger.error(`API Request Failed: ${method} ${path}`, errorMessage);
            throw new Error(errorMessage);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return (await response.json()) as T;
        }

        return (await response.text()) as unknown as T;
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.request<any>('GET', '/api/client/account');
            return true;
        } catch {
            return false;
        }
    }

    async listServers(): Promise<PteroServer[]> {
        const data = await this.request<any>('GET', '/api/client');
        if (!data.data) {
            return [];
        }
        return data.data.map((item: any) => {
            const attrs = item.attributes;
            // Get primary allocation IP
            let allocIp = '';
            let allocPort = 0;
            if (attrs.relationships?.allocations?.data?.length > 0) {
                const primary = attrs.relationships.allocations.data[0].attributes;
                allocIp = primary.ip_alias || primary.ip || '';
                allocPort = primary.port || 0;
            }
            return {
                id: attrs.id || attrs.internal_id,
                uuid: attrs.uuid,
                identifier: attrs.identifier,
                name: attrs.name,
                description: attrs.description || '',
                status: attrs.status,
                node: attrs.node || '',
                is_suspended: attrs.is_suspended || false,
                is_installing: attrs.is_installing || false,
                sftp_details: attrs.sftp_details || { ip: '', port: 2022 },
                limits: {
                    memory: attrs.limits?.memory || 0,
                    disk: attrs.limits?.disk || 0,
                    cpu: attrs.limits?.cpu || 0,
                },
                allocation: {
                    ip: allocIp,
                    port: allocPort
                },
                docker_image: attrs.docker_image || '',
                // Usage will be populated later
            };
        });
    }

    async sendPowerAction(serverUuid: string, signal: 'start' | 'stop' | 'restart' | 'kill'): Promise<void> {
        await this.request('POST', `/api/client/servers/${serverUuid}/power`, { signal });
    }

    async getServerResources(serverUuid: string): Promise<PteroResourceUsage> {
        const data = await this.request<any>('GET', `/api/client/servers/${serverUuid}/resources`);
        return data.attributes;
    }

    async listFiles(serverUuid: string, directory: string = '/'): Promise<PteroFileObject[]> {
        const encoded = encodeURIComponent(directory);
        const data = await this.request<any>('GET', `/api/client/servers/${serverUuid}/files/list?directory=${encoded}`);
        if (!data.data) {
            return [];
        }
        return data.data.map((item: any) => item.attributes as PteroFileObject);
    }

    async getFileContents(serverUuid: string, filePath: string): Promise<string> {
        const encoded = encodeURIComponent(filePath);
        return this.request<string>('GET', `/api/client/servers/${serverUuid}/files/contents?file=${encoded}`);
    }

    async writeFile(serverUuid: string, filePath: string, content: string): Promise<void> {
        const encoded = encodeURIComponent(filePath);
        await this.request<void>('POST', `/api/client/servers/${serverUuid}/files/write?file=${encoded}`, undefined, content);
    }

    async createFolder(serverUuid: string, root: string, name: string): Promise<void> {
        await this.request<void>('POST', `/api/client/servers/${serverUuid}/files/create-folder`, { root, name });
    }

    async deleteFiles(serverUuid: string, root: string, files: string[]): Promise<void> {
        await this.request<void>('POST', `/api/client/servers/${serverUuid}/files/delete`, { root, files });
    }

    async renameFile(serverUuid: string, root: string, from: string, to: string): Promise<void> {
        await this.request<void>('PUT', `/api/client/servers/${serverUuid}/files/rename`, {
            root,
            files: [{ from, to }],
        });
    }

    async chmodFile(serverUuid: string, root: string, file: string, mode: number): Promise<void> {
        await this.request<void>('POST', `/api/client/servers/${serverUuid}/files/chmod`, {
            root,
            files: [{ file, mode }],
        });
    }

    async getResourceUsage(serverIdentifier: string): Promise<PteroResourceUsage> {
        const data = await this.request<any>('GET', `/api/client/servers/${serverIdentifier}/resources`);
        return data.attributes as PteroResourceUsage;
    }

    async getWebSocketCredentials(serverUuid: string): Promise<{ token: string; socket: string }> {
        const data = await this.request<any>('GET', `/api/client/servers/${serverUuid}/websocket`);
        return data.data as { token: string; socket: string };
    }

    async sendCommand(serverUuid: string, command: string): Promise<void> {
        await this.request<void>('POST', `/api/client/servers/${serverUuid}/command`, { command });
    }

    async createSshKey(name: string, publicKey: string): Promise<void> {
        await this.request<void>('POST', '/api/client/account/ssh-keys', {
            name: name,
            public_key: publicKey
        });
    }
}
