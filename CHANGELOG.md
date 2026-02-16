# Change Log

All notable changes to the "pterodactyl-sftp" extension will be documented in this file.

## [2.0.2] - 2026-02-16

- **Fix**: Restored the "Generate Key Pair" button in the manual SSH configuration section of the Add/Edit Account form.

## [2.0.1] - 2026-02-16

- **Fix**: Resolved "Unsupported key format" error by switching Ed25519 key generation to OpenSSH format, ensuring full compatibility with SFTP authentication.

## [2.0.0] - 2026-02-16

### Major UI & UX Overhaul
- **New Premium Design**: Completely redesigned the "Add Account" form with a Pterodactyl-inspired theme for a more professional look and better compatibility with VS Code themes.
- **Embedded SSH Auto-Setup**: You can now automatically generate, save, and upload SSH keys directly during account creation. No manual copy-pasting required.
- **Improved Validation**: Added real-time error feedback and better field validation in the setup process.
- **Documentation**: Added a comprehensive [Vietnamese Tutorial](tutorial.html) integrated into the extension.

## [1.6.4] - 2026-02-16

- Added **Auto SSH Key Setup** feature (`Pterodactyl: Setup Auto SSH Key`).
- Automatically generates Ed25519 keys and uploads them to the Panel.

## [1.6.3] - 2026-02-16

- Updated repository URL
- Improved extension icon

## [1.6.2] - 2026-02-16

- Fixed npm warnings and deprecated dependencies
- Validated release workflow permissions

## [1.6.1] - 2026-02-16

- Improved release workflow automation
- Updated dependencies
- Use PNG icon for marketplace compatibility

## [1.0.0] - 2026-02-16

- Initial release
- Added multi-account support
- Added SFTP file system provider
- Added server power controls (Start, Stop, Restart, Kill)
- Added integrated server terminal
