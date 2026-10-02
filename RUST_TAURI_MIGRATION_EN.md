# Why YASSH Client is moving to Rust + Tauri 2

YASSH Client is moving from Electron to **Rust + Tauri 2** to make the application faster, lighter and more performant.

## Pros

- ⚡ **Faster startup** — the application launches quicker.
- 🧠 **Less RAM** — Tauri does not ship its own Chromium like Electron does.
- 🚀 **High performance** — Rust is a great fit for SSH, SFTP, file and network operations.
- 📁 **Faster SFTP** — Rust allows more efficient handling of uploads, downloads and file operations.
- 📦 **Smaller application size**.
- 🔒 **Rust security and reliability**.
- 🖥️ **Native integration** with Windows, macOS and Linux.
- 🔄 **Auto-updates** via Tauri Updater.

## Cons

### Linux

Linux is still the most challenging platform.

Possible issues with:

- Pacman;
- automatic updates;
- different package formats (`deb`, `rpm`, AppImage and others).

Linux may require separate update logic depending on the installation method.

### Rust

The project gains a new language — Rust. This increases the complexity of developing and maintaining the native part of the application.

## Updates

- **Windows** — nothing fundamentally new, the current scheme stays familiar.
- **macOS** — auto-updates will work via Tauri Updater.
- **Linux** — auto-update depends on the installation format and may require additional work.

## Summary

The main goal of the transition is **faster startup, lower memory usage and high performance**, especially in SSH/SFTP.

React remains the interface, while Rust + Tauri 2 take over the native and performance-critical part of the application.

## How to Migrate

Wait until version **4.\*.\*** or higher appears as the **Latest** release on GitHub.

1. Uninstall the previous version of YASSH Client from your computer.
2. It is recommended to delete everything related to `YetAnotherSSHClient` from `%AppData%`.
3. Install the latest version from GitHub.

**Your configuration will remain intact** and is compatible with the new version.

The only exception is that the **window position and size** may be different on the first launch. After that, the window settings will be saved as usual.
