# Миграция на Tauri 2 + Rust

Документ описывает состояние миграции: что перенесено, что удалено вместе со старой
реализацией, как запускать, собирать и тестировать.

Ветка `dev-v4.0.0`. Electron-реализация **удалена полностью**: каталог `electron/`,
отдельный конфиг сборки, electron-зависимости и workflow для Electron больше не
существуют. Актуальная архитектура описана в [`docs/ARCHITECTURE.md`](ARCHITECTURE.md),
этот документ хранит соответствие «старая реализация → новая» и процедуры сборки.

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

## 2. Что удалено вместе с Electron-реализацией

* каталог `electron/` — вся старая main-логика, включая воркер SFTP-передач;
* `vite.electron.config.ts` и electron-точки сборки в `vite.config.ts`;
* зависимости и скрипты `electron`, `electron-builder`, `electron-updater`, `node-pty`,
  `ssh2`, `vite-plugin-electron`, `vite-plugin-electron-renderer` и скрипты
  `dev:electron`, `build:electron`, `package:electron*`;
* workflow `.github/workflows/build-electron.yml` (остался `build-tauri.yml`);
* тесты, проверявшие только мёртвый код `electron/src/**`: `auth-credentials`,
  `config-client-id`, `config-favorites-secrets`, `config-recovery-key-cache`,
  `mcp-log-buffer`, `private-key`, `sftp-transfer-common`, `sftp-transfer-worker`,
  `sftp-utils`, `ssh-executor`, `stream-output-collector`, `telemetry`, `vault`.

Покрытие, которое проверяли удалённые тесты, перенесено в модульные тесты бэкенда
(`ssh/auth.rs`, `mcp.rs`, `telemetry.rs`, `config.rs`, `sanitize.rs`, `updates.rs`,
`keys.rs`, `sftp/*`). Сквозные сценарии SFTP-сессии и передач в тесты не переносятся: они
требуют живой SSH-сервер.

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

# Тесты (все тесты проекта лежат в src-tauri/src/tests/)
npm run test            # cargo test

# Линт
npm run lint
```

Первая сборка Rust занимает заметное время: `russh` + `aws-lc-rs` собираются
с нуля.

Тесты фронтенда на TypeScript удалены вместе с покрытием мёртвого кода
Electron-версии: проверяемая логика переехала в Rust и покрыта модульными
тестами (см. `docs/ARCHITECTURE.md`, раздел 4.1).

### Тесты на Windows

`npm run test` (`cargo test`) на Windows падает не из-за кода: тест-бинарь
линкуется против `WebView2Loader.dll` (её нет в `System32`) и против `comctl32` v6
(`TaskDialogIndirect`), а манифест с зависимостью Common-Controls v6 есть только у
приложения, которое собирает `tauri`, — но не у harness-бинаря `cargo test`.

Обходной путь (репозиторий не меняется, файлы живут в `target/` и `Temp`):

```powershell
# 1. WebView2Loader.dll рядом с тест-бинарём
Copy-Item src-tauri\target\debug\build\webview2-com-sys-*\out\x64\WebView2Loader.dll `
          src-tauri\target\debug\deps\ -Force

# 2. Манифест Common-Controls v6 вшивается ресурсом (линковщик MinGW манифесты
#    не поддерживает, поэтому через windres)
#    app.rc:  1 24 "app.manifest"
windres -i app.rc -o app-manifest.o --target=pe-x86-64
cargo rustc --profile test --lib -- -C link-arg="<путь>\app-manifest.o"

# 3. Запуск свежесобранного бинаря из src-tauri\target\debug\deps\
```

Содержимое `app.manifest` — стандартная декларация зависимости
`Microsoft.Windows.Common-Controls 6.0.0.0` (`publicKeyToken=6595b64144ccf1df`).
Для MSVC достаточно ключа линковщика `/MANIFESTDEPENDENCY:...`; собирать проект
на MSVC ради этого не обязательно.

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

Сборка и запуск выполнены, модульные тесты проходят: `npm run test` (188 тестов
бэкенда, см. обходной путь для Windows в разделе 4). Вручную на окружении с
Windows + Rust проверены: запуск и закрытие приложения, сохранение геометрии
окна между запусками (в том числе на 125 % DPI), SSH-подключение с паролем и
ключом, перенаправление портов, SFTP-передачи с прогрессом, локальный терминал.

Перед принятием миграции остаётся проверить на целевых ОС:

1. `npm ci && npm run build` на ubuntu-24.04 / windows-latest / macos-15 — сборка всех
   бандлов (в CI это делает `build-tauri.yml`).
2. Чистая установка и переход со старой версии — по процедуре из
   `docs/UPDATER.md`, раздел 6.
3. Полный цикл обновления (minisign-подпись, манифест `src-tauri/updater/latest.json`) —
   раздел 6.3.
4. Ручная проверка сценариев на Linux и macOS: SSH-терминал, ввод учётных данных и
   passphrase, SFTP (загрузка/скачивание файлов и папок, отмена, перезапись),
   перенаправление портов, локальный терминал, MCP с подтверждением команд,
   импорт/экспорт конфига, файловые ассоциации.
