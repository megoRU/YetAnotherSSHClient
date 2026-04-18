# YetAnotherSSHClient

YetAnotherSSHClient is a lightweight and fast open-source SSH client designed for developers and system administrators.

It provides a clean and simple interface for managing remote servers without unnecessary complexity.

> ⚠️ The application interface is currently available in Russian only. English localization may be added in future releases.
---

## 🚀 Features

- Tab support
- Favorite servers
- Key-based authentication
- Multiple UI themes
- Customizable fonts
- Fast server connection
- Cross-platform (Windows / Linux / macOS)

---

## ⬇️ Download latest version

<p align="center">

<a href="https://github.com/megoRU/YetAnotherSSHClient/releases/latest/download/YASSHClient-windows-x64.exe">
  <img src="https://img.shields.io/badge/Windows-x64-0078D6?style=for-the-badge&logo=windows&logoColor=white" />
</a>

<a href="https://github.com/megoRU/YetAnotherSSHClient/releases/latest/download/YASSHClient-windows-arm64.exe">
  <img src="https://img.shields.io/badge/Windows-ARM64-0078D6?style=for-the-badge&logo=windows&logoColor=white" />
</a>

<a href="https://github.com/megoRU/YetAnotherSSHClient/releases/latest/download/YASSHClient-linux-x86_64.AppImage">
  <img src="https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=black" />
</a>

<a href="https://github.com/megoRU/YetAnotherSSHClient/releases/latest/download/YASSHClient-macos-arm64.dmg">
  <img src="https://img.shields.io/badge/macOS-Apple-000000?style=for-the-badge&logo=apple&logoColor=white" />
</a>

</p>

---

## 🖼️ Screenshots

> Recommended font: [JetBrains Mono](https://www.jetbrains.com/lp/mono/)

### 🌙 Dark theme

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/GruvboxDark.png?raw=true)

### 🌾 Gruvbox Light

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/GruvboxLight.png?raw=true)

---

## 🧩 Technologies

- React
- Electron
- xterm.js
- ssh2

---

## ⚙️ Configuration

Config file location:

- Windows  
  `C:\Users\<username>\.minissh_config.json`

- Linux / macOS  
  `~/.minissh_config.json`

---

## ⚠️ macOS

If you see **"App is damaged"**, run:

```bash
sudo xattr -cr /Applications/YASSHClient.app
```

## 🔐 Code signing policy

Free code signing is provided by [SignPath.io](https://signpath.io), certificate by SignPath Foundation.

Committers and reviewers:
[megoRU](https://github.com/megoRU)

Approvers:
[megoRU](https://github.com/megoRU)

All changes are manually reviewed before being included in a release.

All release artifacts are built from the public repository.

AI-assisted code may be used, but all contributions are verified by the repository owner.

## 🔒 Privacy

This application does not collect, store, or transmit any user data.

All operations are performed locally unless explicitly initiated by the user (e.g. SSH connection).

## 📄 License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).