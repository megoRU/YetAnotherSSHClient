# Миграция на Tauri 2 + Rust

Документ описывает состояние миграции: что перенесено, что осталось в старой
реализации, как запускать и собирать.

Ветка `dev-v4.0.0`. Electron-реализация **не удалена**: она лежит в
`electron/`, собирается отдельным конфигом и используется для сравнения и для
отката.

## 1. Что перенесено

| Область | Electron | Tauri / Rust |
| --- | --- | --- |
| Окно | `electron/main.ts` | `src-tauri/src/window.rs` |
| Конфиг | `electron/src/config.ts` | `src-tauri/src/config.rs` |
| Вольт (AES-256-GCM + scrypt) | `electron/src/vault.ts` | `src-tauri/src/vault.rs` |
| Кэш ключа восстановления | `safeStorage` | системное хранилище (`keychain.rs`) |
| Приватные ключи | `electron/src/private-key.ts` | `src-tauri/src/keys.rs` |
| Логи и санитизация | `electron/src/logger.ts` | `src-tauri/src/logger.rs`, `sanitize.rs` |
| Локализация main-процесса | `electron/src/i18n-main.ts` | `src-tauri/src/i18n.rs` + `i18n/main.json` |
| SSH | `ssh2` | `russh` 0.63 (чистый Rust) |
| Авторизация | `auth-credentials.ts`, `ssh-auth.ts` | `ssh/auth.rs`, `ssh/registry.rs` |
| SFTP | `ssh2` + воркер в `utilityProcess` | `russh-sftp` + задачи tokio |
| MCP | `@modelcontextprotocol/sdk` | протокол JSON-RPC напрямую (`mcp.rs`) |
| Локальный терминал | `node-pty` | `portable-pty` (ConPTY / pty) |
| Обновления | `electron-updater` | `tauri-plugin-updater` (minisign) |
| IPC | `ipcMain.on/handle` | команды Tauri с теми же именами |
| Мост renderer | `contextBridge` в preload | `src/ipc/tauri-bridge.ts` |

Формат `~/.minissh_config.json` не изменился: бэкапы совместимы в обе стороны.

## 2. Что осталось в Electron-реализации

* `electron/**` — вся старая main-логика, включая воркер SFTP-передач.
* `vite.electron.config.ts` — конфигурация сборки (перенесена из
  `vite.config.ts` без изменений).
* Скрипты `dev:electron`, `build:electron`, `package:electron*`.
* Workflow `.github/workflows/build-electron.yml` (ветка `main`).

Удалить их можно только после того, как Tauri-сборка пройдёт проверку на
чистой установке и при переходе со старой версии (см. `docs/UPDATER.md`).

## 3. Структура `src-tauri`

```
src-tauri/
├── Cargo.toml
├── build.rs
├── tauri.conf.json          # конфигурация приложения и бандлинга
├── capabilities/default.json# минимальные права webview (core:default)
├── i18n/main.json           # словарь main-процесса (ru/en)
├── updater/latest.json      # манифест автообновления (в репозитории)
├── icons/                   # иконки, генерируются скриптом
└── src/
    ├── main.rs, lib.rs
    ├── commands.rs          # команды Tauri (бывшие каналы ipcMain)
    ├── commands_sftp.rs     # SFTP-команды
    ├── config.rs            # AppConfig / SSHConfig, миграции
    ├── vault.rs             # AES-256-GCM + scrypt
    ├── keychain.rs          # системное хранилище ключа восстановления
    ├── keys.rs              # приватные ключи SSH
    ├── sanitize.rs          # очистка секретов в логах
    ├── logger.rs            # кольцевой буфер логов
    ├── i18n.rs, paths.rs
    ├── state.rs             # общее состояние приложения
    ├── window.rs            # окно, геометрия, показ
    ├── ssh/                 # auth, handler, session, registry
    ├── sftp/                # session, files, transfer, progress, archive, utils
    ├── mcp.rs               # HTTP-сервер MCP и менеджеры
    ├── local_terminal.rs
    ├── updates.rs           # автообновление
    └── telemetry.rs
```

## 4. Запуск и сборка

Требуется Node.js 22+ и Rust toolchain (stable, 1.85+). Системные
зависимости для Linux перечислены в `.github/workflows/build-tauri.yml`.

```bash
npm ci

# Разработка: Tauri + Vite dev-сервер на 1420
npm run dev

# Только renderer (быстрая проверка вёрстки)
npm run dev:vite

# Релизная сборка (артефакты в src-tauri/target/release/bundle)
npm run build

# Иконки для бандлинга
npm run icons:tauri

# Тесты
npm run test            # vitest (фронтенд)
npm run test:rust       # cargo test

# Линт
npm run lint

# Старая Electron-сборка
npm run dev:electron
npm run build:electron
```

Первая сборка Rust занимает заметное время: `russh` + `aws-lc-rs` собираются
с нуля.

## 5. Соответствие контракта IPC

Имена команд совпадают с каналами Electron, события приходят в те же каналы:

* `invoke('ssh-connect', payload)` → `ssh-connect-${id}`;
* `listen('mcp-log')`, `listen('update-status')` и т. д. — без изменений.

Отличия, о которых важно знать:

* **Вывод терминала** (`ssh-output-${id}`, `local-terminal-output-${id}`)
  приходит в base64. Мост декодирует его в `Uint8Array`/`string` до вызова
  подписчика, поэтому React-код не меняется.
* **`getPathForFile`** реализован через событие `yash-drag-drop-paths`:
  пути сопоставляются с объектами `DataTransfer` по индексу. При несовпадении
  количества возвращается пустая строка.
* **`Ctrl+R` / `F5`** перехватываются в DOM моста (capture-фаза), а не в
  main-процессе: у Tauri нет аналога `before-input-event`.
* **Ошибки команд** приходят в `invoke` как локализованные строки — тот же
  формат, что возвращал Electron.

## 6. Известные отличия в поведении

| Отличие | Причина | Влияние |
| --- | --- | --- |
| Авторазблокировка хранилища требует одного ввода ключа после перехода с Electron | `safeStorage` недоступен Tauri | Ключ вводится один раз, дальше лежит в системном хранилище |
| SFTP-передачи выполняются задачами tokio, а не в отдельном процессе | Tauri не нужна граница процесса | Поведение то же; отдельный воркер-плагин убран |
| Наблюдение за изменённым файлом — опрос метаданных раз в 500 мс | Нет `fsnotify` без платформенных зависимостей | Та же задержка, что была у `fs.watch` с дебаунсом |
| Отдельное окно для перенаправления портов не создаётся | Перенаправление выполняется нативно | `PortForwardingView` остаётся доступен по прямой ссылке с параметрами |
| MCP реализован без `@modelcontextprotocol/sdk` | Убрана самая тяжёлая транзитивная зависимость | Внешний контракт (endpoint, авторизация, инструменты) сохранён |
| Телеметрия и обновление отключаются фоновой проверкой раз в 6 часов | Тот же интервал, что и в Electron | Без изменений для пользователя |

## 7. Что осталось проверить

Миграция выполнена по коду, но **не собрана и не запущена**: в среде, где
выполнялась работа, нет Rust toolchain, а устанавливать его нельзя. Перед
принятием миграции нужно выполнить на машине с Rust:

1. `npm ci && npm run build` — сборка всех бандлов; убедиться, что нет ошибок
   компиляции Rust.
2. `npm run test:rust` — юнит-тесты вольта, санитизатора, конфига, путей,
   обновлений, MCP.
3. Чистая установка и переход со старой версии — по процедуре из
   `docs/UPDATER.md`, раздел 6.
4. Полный цикл обновления — раздел 6.3.
5. Ручная проверка сценариев: SSH-терминал, ввод учётных данных и
   passphrase, SFTP (загрузка/скачивание файлов и папок, отмена, перезапись),
   перенаправление портов, локальный терминал, MCP с подтверждением команд,
   импорт/экспорт конфига, файловые ассоциации.
