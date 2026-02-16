# Pterodactyl SFTP for VS Code

Connect to your Pterodactyl panel servers, browse and edit files remotely effectively, and manage server power states directly from VS Code.

## Features

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
