# Pterodactyl SFTP for VS Code 🦕

Manage your Pterodactyl panel servers directly from VS Code. Browse, edit, and sync files with high security and speed.

[📖 Tài liệu hướng dẫn sử dụng (Tiếng Việt)](file:///./tutorial.html)

## Features

### 🔑 Auto SSH Key Setup (New in v1.6.4)
NOTE: This feature requires `ssh-keygen` behavior but is fully implemented in Node.js.
1.  Open the Command Palette (`Ctrl+Shift+P`).
2.  Run **Pterodactyl: Setup Auto SSH Key**.
3.  Select the account you want to configure.
4.  Enter a name for the key (e.g., `VSCode Key`) and an optional passphrase.
5.  The extension will:
    *   Generate a secure **Ed25519** SSH key pair.
    *   **Save the Private Key** to your local `.ssh` directory.
    *   **Upload the Public Key** automatically to your Pterodactyl Panel account.

-   **Server Management**: View all your servers in the "Pterodactyl SFTP" view.
-   **SFTP Integration**:
    -   Connect to servers via SFTP protocol automatically.
    -   Browse, open, edit, and save files directly in VS Code.
    -   File operations upload seamlessly to your server.
-   **Power Actions**:
    -   Start, Stop, Restart, and Kill servers from the context menu or command palette.
-   **Terminal Access**:
    -   Open a streamlined terminal to send commands to your server console.
-   **Account Management**:
    -   Add multiple Pterodactyl API accounts.
    -   Import/Export account data for backup.

## Requirements

To use this extension, you need:

1.  **Pterodactyl Panel URL**: The URL to your panel (e.g., `https://panel.example.com`).
2.  **API Key**: A client API key from your Pterodactyl account settings.

## Usage

1.  Open the **Pterodactyl SFTP** view in the Activity Bar (icon looks like a feather/wing).
2.  Click the **Add Account** (+) button.
3.  Enter your Panel URL and API Key.
4.  Once added, your servers will list automatically.
5.  **Right-click** a server to:
    -   **Connect**: Mounts the server files as a workspace folder.
    -   **Terminal**: Opens a console interface.
    -   **Power**: Start/Stop/Restart/Kill.

## Extension Settings

This extension contributes the following settings:

*   `pterodactyl.addAccount`: Add a new Pterodactyl account.
*   `pterodactyl.refreshServers`: Refresh the list of servers.

## Known Issues

-   Large file transfers may take time depending on network connection.
-   Ensure your Pterodactyl node has SFTP ports open and accessible.

## Release Notes

### 1.0.0

Initial release of Pterodactyl SFTP extension.
-   Multi-account support.
-   SFTP file editing.
-   Power management.
-   Console terminal.
