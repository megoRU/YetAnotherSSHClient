# YetAnotherSSHClient

YetAnotherSSHClient — лёгкий и быстрый SSH-клиент для работы с серверами.  
Создан для разработчиков и администраторов, которым нужен простой и удобный инструмент без лишней сложности.

## 🚀 Возможности

- Поддержка вкладок
- Добавление серверов в избранное
- Аутентификация по ключу
- Множество тем оформления
- Гибкая настройка шрифтов
- Быстрое подключение к серверам
- Кроссплатформенность (Windows / Linux / macOS)

## ⬇️ Скачать последнюю версию

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

## 🖼️ Скриншоты

> ⚠️ Рекомендуется использовать шрифт: [JetBrains Mono](https://www.jetbrains.com/lp/mono/)

### 🌙 Тёмная тема

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/GruvboxDark.png?raw=true)

### 🌾 Gruvbox Light

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/GruvboxLight.png?raw=true)

---

## 🧩 Используемые технологии

- React
- Electron
- xterm.js
- ssh2

---

## ⚙️ Конфигурация

Файл настроек хранится локально:

- Windows  
  `C:\Users\<username>\.minissh_config.json`

- Linux / macOS  
  `~/.minissh_config.json`

---

## ⚠️ macOS

Если при запуске появляется ошибка **"Приложение повреждено"**, выполните:

```bash
sudo xattr -cr /Applications/YASSHClient.app
```

## 📄 License

Copyright © 2026 megoRU

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License v3 or later.

For full license text, see [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.en.html).
