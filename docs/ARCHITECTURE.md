# Архитектура YetAnotherSSHClient

Данный документ описывает общую архитектуру приложения: процессы, модули, границу между
Rust-бэкендом и React-интерфейсом и отвечает на вопрос «где что лежит и как это найти».

Соответствие старой (Electron) реализации и Tauri-версии вынесено в
[`docs/MIGRATION_TAURI.md`](MIGRATION_TAURI.md); здесь описан только текущий код.

## 1. Обзор

**YetAnotherSSHClient** — кроссплатформенное (Windows / Linux / macOS) десктопное приложение
для работы с SSH. Стек:

| Слой       | Технологии                                                              |
|------------|-------------------------------------------------------------------------|
| UI         | React 19, TypeScript (strict), Vite 7                                   |
| Shell      | Tauri 2 + системный webview (WebView2 / WKWebView / WebKitGTK)          |
| SSH / SFTP | `russh` 0.63 и `russh-sftp` — клиент SSH, SFTP, порт-форвардинг         |
| Terminal   | `@xterm/xterm` + аддоны `fit`, `webgl`, `web-links`, `clipboard`; локальный терминал — `portable-pty` (ConPTY / pty) |
| MCP        | собственный JSON-RPC поверх Streamable HTTP (`mcp.rs`), без SDK          |
| Обновления | `tauri-plugin-updater` (minisign, манифесты `src-tauri/updater/latest.json` и `src-tauri/updater/prerelease.json`) |
| Секреты    | `keyring` — Credential Manager / Keychain / libsecret                     |

Ключевые возможности: SSH-терминал во вкладках, SFTP-браузер с передачами и прогрессом,
перенаправление портов, локальный терминал, MCP-сервер для ИИ-агентов, хранилище паролей
(vault), автообновления, темы и i18n (ru/en).

---

## 2. Процессы и границы

Приложение — **один процесс**: Rust-часть и системный webview, в который загружается
собранный фронтенд (`dist/`). Отдельного preload-слоя, как в Electron, нет: контракт
доступа из интерфейса реализует TypeScript-мост `src/ipc/tauri-bridge.ts`.

```
┌────────────────────────────────────────────────────────────────────────┐
│  ПРОЦЕСС ПРИЛОЖЕНИЯ  (src-tauri/src)                                   │
│  • окно, конфиг, vault, логи                                           │
│  • SSH-сессии (russh): терминалы, SFTP, перенаправление портов          │
│  • локальные терминалы (portable-pty)                                  │
│  • MCP-сервер, обновления, телеметрия                                  │
│  • #[tauri::command] — команды, доступные webview                      │
└───────────────┬────────────────────────────────▲───────────────────────┘
                │  invoke(команда) / listen(канал)  │  emit(событие)
┌───────────────┴────────────────────────────────┴───────────────────────┐
│  WEBVIEW  (dist/)                                                      │
│  • React UI, вкладки, состояние, drag&drop                             │
│  • src/ipc/tauri-bridge.ts — объект window.ipcRenderer                 │
│  • доступа к Node.js и файловой системе нет                            │
└────────────────────────────────────────────────────────────────────────┘
```

Правило безопасности:

* webview видит только `core:default` (`src-tauri/capabilities/default.json`) — никаких
  FS, shell и сетевых API;
* всё общение с системой идёт через команды, объявленные в `generate_handler!`
  (`src-tauri/src/lib.rs`);
* файлы для SFTP передаются Rust-командами **по путям** (native drag&drop отдаёт пути
  отдельным событием), а не через DOM-`File` — это снимает зависимость от того, отдаёт ли
  webview `File.path`.

---

## 3. Структура репозитория

```text
YetAnotherSSHClient/
├── src/                        # WEBVIEW (React)
│   ├── main.tsx                # точка входа, initRendererLogger, installIpcBridge
│   ├── App.tsx                 # корневой компонент, вкладки, модалки, глобальные состояния
│   ├── App.css / index.css     # базовые стили
│   ├── global.d.ts             # объявление window.ipcRenderer
│   ├── types.ts                # общие типы (AppConfig, SSHConfig, Tab, Sftp*, MCP…)
│   ├── ipc/                    # ТИПЫ + КОНТРАКТ + МОСТ (см. раздел 5)
│   │   ├── index.ts            # barrel типов
│   │   ├── renderer-api.ts     # интерфейс IpcRendererApi (главный контракт)
│   │   ├── tauri-bridge.ts     # реализация контракта поверх invoke/listen
│   │   ├── install-tauri-bridge.ts
│   │   └── ssh.ts / sftp.ts / mcp.ts / system.ts / update.ts / vault.ts
│   ├── components/             # UI-компоненты (см. раздел 6)
│   ├── hooks/                  # хуки (см. раздел 6)
│   │   └── sftp/               # хуки SFTP: соединение, каталог, выделение, трансферы
│   ├── styles/                 # темы xterm + CSS: dark/light/gruvbox/windows-terminal
│   └── utils/                  # утилиты (см. раздел 6)
│
├── src-tauri/                  # RUST (Tauri 2)
│   ├── Cargo.toml / Cargo.lock
│   ├── build.rs
│   ├── tauri.conf.json         # окно, CSP, бандлинг, updater
│   ├── capabilities/default.json
│   ├── i18n/main.json          # словарь бэкенда (ru/en)
│   ├── updater/latest.json     # манифест стабильного канала (генерируется в CI)
│   ├── updater/prerelease.json # манифест канала pre-release (генерируется в CI)
│   ├── icons/                  # иконки бандла (генерируются скриптом)
│   └── src/                    # бэкенд (см. раздел 7)
│       └── tests/              # ВСЕ тесты проекта (см. раздел 4.1)
│
├── public/                     # fonts/ (TTF), icons/, sound/
├── scripts/                    # tauri-dev.mjs, generate-tauri-icons.mjs, gen-updater-*.mjs
├── docs/                       # этот документ, MIGRATION_TAURI.md, UPDATER.md
├── images/                     # скриншоты для README
├── index.html, vite.config.ts, eslint.config.js
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── package.json / package-lock.json
├── AGENTS.md
└── .github/workflows/build-tauri.yml   # CI: сборка и draft-релиз
```

---

## 4. Ключевые скрипты, сборка и тесты

| Команда                       | Что делает                                        |
|-------------------------------|---------------------------------------------------|
| `npm run dev`                 | dev-режим: Vite на 127.0.0.1:1420 + `tauri dev`   |
| `npm run dev:vite`            | только фронтенд (быстрая проверка вёрстки)        |
| `npm run build`               | релизная сборка (`tauri build`)                   |
| `npm run build:vite`          | только бандл фронтенда в `dist/`                  |
| `npm run icons:tauri`         | генерация иконок бандла из `public/icons`         |
| `npm run test`                | `cargo test` — все тесты проекта                  |
| `npm run lint`                | eslint                                            |

* `npm run dev` вызывает `scripts/tauri-dev.mjs`: скрипт проверяет наличие Cargo, при
  необходимости дописывает в `PATH` `~/.cargo/bin` и MinGW-компилятор и только затем
  запускает `tauri dev`.
* `tauri.conf.json`: `devUrl = http://127.0.0.1:1420`, `frontendDist = ../dist`, окно
  создаётся кодом (`app.windows` пуст), CSP разрешает только `ipc:`, `asset:`, dev-сервер и
  API проекта.
* CI (`.github/workflows/build-tauri.yml`): push в `dev-v4.0.0` или `main` либо ручной запуск; сборка под
  `ubuntu-24.04` / `windows-latest` / `macos-15`, артефакты загружаются, затем создаётся
  **draft-релиз**. При `TAURI_UPDATER_ENABLED = true` сборка подписывается minisign-ключом, а
  `scripts/gen-updater-manifest.mjs` обновляет `src-tauri/updater/latest.json`
  (стабильный канал) и `src-tauri/updater/prerelease.json` (канал pre-release,
  включается настройкой «Получать обновления Pre-release»).
* Автообновление на macOS ограничено правилами App Store, поэтому фоновая проверка там
  отключена.

### 4.1. Тесты

Все тесты проекта живут в одной папке — `src-tauri/src/tests/`, и запускаются одной
командой `npm run test` (`cargo test`). Тесты фронтенда на TypeScript удалены: проверяемая
логика переехала в Rust, а оставшиеся чистые функции интерфейса покрываются компиляцией и
линтером.

Подключение тестов к модулю — две строки в его исходнике:

```rust
#[cfg(test)]
#[path = "tests/keys.rs"]   // или "../tests/sftp_utils.rs" для вложенных модулей
mod tests;
```

Тесты видят приватные детали модуля (иначе их пришлось бы делать публичными), но физически
лежат отдельно от рабочего кода.

| Файл тестов                  | Что проверяет                                                        |
|------------------------------|----------------------------------------------------------------------|
| `keys.rs`                    | разбор ключей: OpenSSH, PEM (PKCS#8/PKCS#1), PPK, определение шифрования |
| `vault.rs`                   | шифрование, отказ при подмене данных, неверный ключ и соль             |
| `config.rs`                  | нормализация, миграции, вырезание секретов при записи                 |
| `window.rs`                  | геометрия окна, перевод физических пикселей, снимок конфига            |
| `ssh_session.rs`             | подключение по паролю и ключу, ввод в оболочку, exec, размеры PTY     |
| `ssh_registry.rs`            | ввод и команды при подключении, перенаправление портов                 |
| `ssh_auth.rs`                | план авторизации и приоритет источников credentials                    |
| `ssh_handler.rs`             | локализация ошибок SSH                                                |
| `ssh_server.rs`               | общий встроенный SSH-сервер для тестов (не тест сам по себе)          |
| `sftp_*`                     | пути, прогресс, статусы, команды, отмена, результаты передач           |
| `mcp.rs`                     | авторизация Bearer, схемы инструментов, буфер журнала                   |
| `local_terminal.rs`          | реальный PTY: запуск оболочки и возврат вывода                          |
| `keychain.rs`                | цикл «записать → прочитать → удалить» в системном хранилище            |
| `updates.rs`, `telemetry.rs`, `logger.rs`, `sanitize.rs`, `i18n.rs`, `paths.rs`, `error.rs`, `window.rs`, `state.rs` | вспомогательная логика |

Принципы, которых держатся тесты:

* **приватных ключей в исходниках нет** — все ключи генерируются кодом из системной
  энтропии при запуске теста;
* **глобальное состояние (хранилище секретов, язык, системное хранилище) блокируется**
  блокировкой `vault::test_guard()` / `i18n::test_guard()`: тесты идут параллельно;
* **SSH проверяется настоящим сервером** — встроенный сервер из `tests/ssh_server.rs`
  поднимается на `127.0.0.1:0` и не требует внешнего `sshd`.

`cargo test` на Windows требует ручной подготовки окружения (бинарь теста линкуется против
`WebView2Loader.dll` и `comctl32` v6) — процедура описана в
[`docs/MIGRATION_TAURI.md`](MIGRATION_TAURI.md), раздел 4.

---

## 5. IPC — команды и события

### 5.1. Договор (contract)

| Файл                            | Роль                                                          |
|---------------------------------|---------------------------------------------------------------|
| `src/ipc/renderer-api.ts`       | **Единственный контракт**: интерфейс `IpcRendererApi`         |
| `src/ipc/tauri-bridge.ts`       | реализует контракт поверх `invoke`/`listen`, вешает `window.ipcRenderer` |
| `src/ipc/install-tauri-bridge.ts` | точка входа моста (вызывается из `main.tsx`)                |
| `src/global.d.ts`               | `window.ipcRenderer: IpcRendererApi`                          |
| `src-tauri/src/lib.rs`          | `invoke_handler(generate_handler![...])` — **единственный** список команд |
| `src-tauri/src/commands.rs`     | команды Tauri (бывшие каналы `ipcMain`)                      |
| `src-tauri/src/commands_sftp.rs`| SFTP-команды                                                  |
| `src/ipc/*.ts`                  | типы payload'ов/результатов по доменам                       |

> Чтобы добавить новое действие: описать метод в `src/ipc/renderer-api.ts` → реализовать
> его в `tauri-bridge.ts` → добавить `#[tauri::command]` в `commands.rs`/`commands_sftp.rs` →
> вписать его в `generate_handler!` в `lib.rs`.

Имена команд и каналов событий **намеренно совпадают с прежними** (`ssh-connect`,
`sftp-readdir`, `mcp-toggle`, `check-updates`, `window-minimize`, …), поэтому React-код
одинаково работает с обеими реализациями и не переписывался при переходе.

### 5.2. Соглашение об именовании

* **Команды** (webview → бэкенд): домен-префикс + действие, напр. `ssh-connect`,
  `sftp-readdir`, `vault-unlock`, `check-updates`.
* **События-ответы** (бэкенд → webview): `домен-событие-<sessionId>`. SessionId генерируется
  в интерфейсе и уникален для вкладки, поэтому одна вкладка не читает чужие события.
  Примеры: `ssh-output-<id>`, `ssh-status-<id>`, `ssh-error-<id>`,
  `sftp-transfer-start-<id>`, `sftp-progress-<id>`, `local-terminal-output-<id>`,
  `local-terminal-exit-<id>`.
* **Глобальные события** (без id): `update-status`, `update-available`, `update-progress`,
  `mcp-status-changed`, `mcp-log`, `mcp-request-confirmation`, `window-maximized-state`,
  `app-reload-request`.

Подписка всегда идёт через метод контракта: `onSSHOutput(id, cb)`, `onSFTPStatus(id, cb)` и
т.д. — прямых `listen` в компонентах нет.

### 5.3. Особенности реализации

* **Вывод терминала** (`ssh-output-<id>`, `local-terminal-output-<id>`) передаётся в base64:
  JSON-массив чисел на каждом чанке заметно дороже. Мост декодирует его до `string` /
  `Uint8Array` до вызова подписчика, поэтому компоненты не знают об этом.
* **`getConfigSync()`** обязан быть синхронным (`useConfig` читает конфиг до первого
  `await`). Снимок конфига подставляется скриптом инициализации Tauri в
  `window.__YASSH_BOOTSTRAP__` **до** загрузки приложения.
* **`Ctrl+R` / `F5`** перехватываются в DOM моста (capture-фаза): у Tauri нет аналога
  `before-input-event`, а `preventDefault` в webview надёжно отменяет перезагрузку.
* **Drag&drop файлов** — нативное событие Tauri: пути приходят отдельным событием и
  сопоставляются с объектами `DataTransfer` по индексу; при несовпадении количества
  возвращается пустая строка.
* **Ошибки команд** приходят в `invoke` как локализованные строки (`AppError`), тот же формат,
  что ожидает React.
* **SSH-вывод** батчится на бэкенде перед отправкой, **SFTP-прогресс** прореживается до
  одного события в 100 мс (`sftp/progress.rs`) — иначе webview тонет в событиях.

---

## 6. Фронтенд (React): компоненты, хуки, утилиты

### 6.1. Компоненты (`src/components`)

| Компонент                            | Назначение / IPC                                                                                          |
|--------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `Terminal.tsx`                       | SSH-терминал. **Пайплайн: шрифт → term.open → rAF → fitAddon.fit() → sshConnect**; `onSSHOutput/onSSHStatus/onSSHError/onSSHOSInfo`. Аддоны: fit, webgl, web-links, clipboard |
| `LocalTerminal.tsx`                  | Локальный PTY (`portable-pty`). Старт командой `local-terminal-start`, вывод — `local-terminal-output-<id>` |
| `SFTPBrowser.tsx`                    | SFTP-вкладка: каталоги, файлы, трансферы, drag&drop. Логика вынесена в `hooks/sftp/*`                       |
| `ConnectionForm.tsx`                 | форма создания/редактирования подключения (вставка/загрузка приватного ключа, `encryptPrivateKey`)          |
| `McpTab.tsx`                         | вкладка MCP: статус, агенты, подтверждения, таймлайн (`onMcpStatusChanged/onMcpLog/onMcpRequestConfirmation`) |
| `layout/TitleBar.tsx`                | кастомный тайтлбар, вкладки, drag-drop, кнопки окна                                                     |
| `layout/Sidebar.tsx`                 | список избранных серверов + поиск                                                                         |
| `layout/ContextMenu.tsx`             | портальное контекстное меню                                                                               |
| `layout/CustomSelect.tsx`            | кастомный селект                                                                                          |
| `layout/ErrorBoundary.tsx`           | предохранитель React                                                                                      |
| `views/HomeView.tsx`                 | карточки серверов, поиск, баннер лицензии                                                                 |
| `views/SettingsView.tsx`             | корень настроек, секции в `views/settings/*` (терминал, интерфейс, SFTP, MCP, логи, бэкап, лицензия, …)     |
| `views/OnboardingView.tsx`           | онбординг                                                                                                  |
| `views/PortForwardingView.tsx`       | перенаправление портов (`ssh-forward-start/stop`)                                                           |
| `views/support/SupportView.tsx`      | поддержка, лицензия, спонсоры                                                                              |
| `modals/*.tsx`                       | VaultUnlock/RecoveryKey/Delete/Notification/Toast, SshAuth, LoginPrompt                                    |
| `sftp/*.tsx`                         | SftpToolbar, SftpFileList, SftpTransferPanel, SftpModals                                                  |

### 6.2. Хуки (`src/hooks`)

| Хук                      | Назначение / IPC                                                        |
|--------------------------|-------------------------------------------------------------------------|
| `useConfig.ts`           | глобальный конфиг (`getConfigSync`/`saveConfig`) с миграцией и темой   |
| `useTabs.ts`             | стейт вкладок (без IPC)                                                |
| `useTerminalFit.ts`      | пересчёт размеров терминала при изменении окна                         |
| `useSystemFonts.ts`      | статический список системных шрифтов                                   |
| `useUpdateChecker.ts`    | мониторинг обновлений (все `onUpdate*`)                                 |
| `useGlobalShortcuts.ts`  | глобальные горячие клавиши                                              |
| `usePrivateKeyInput.ts`  | состояние ввода приватного ключа и его проверки формата                |
| `hooks/sftp/useSftp*.ts` | соединение, события, каталог, выбор, трансферы, file-changed           |

### 6.3. Утилиты (`src/utils`)

| Утилита             | Роль                                                                                     |
|---------------------|------------------------------------------------------------------------------------------|
| `i18n.ts`           | резолвер `t('path.to.key')` (подстановка `{param}`)                                      |
| `translations.ts`   | словари `ru`/`en` для UI. Словарь бэкенда лежит отдельно — `src-tauri/i18n/main.json`    |
| `privateKey.ts`     | `looksLikePrivateKey` — быстрая проверка содержимого ключа в форме                        |
| `theme.ts`          | ANSI-цвета xterm для каждой темы                                                          |
| `shortcuts.ts`, `terminalKeys.ts` | матчеры горячих клавиш, отправка в терминал                              |
| `fontLoader.ts`     | `ensureTerminalFont` — предзагрузка TTF через Font API                                   |
| `license.ts`        | валидация лицензии через API проекта                                                      |
| `logSanitizer.ts`   | санитизация секретов в логах рендерера (порядок правил совпадает с `sanitize.rs`)         |
| `mcpAgents.ts`      | `collectAgents` — агенты MCP без дублей                                                  |
| `mcpLogs.ts`        | `mergeLogs` — слияние истории журнала MCP с живыми `mcp-log` (гонка при открытии вкладки)  |
| `rendererLogger.ts` | мост `console.*` рендерера → `log-renderer-msg`                                          |
| `index.ts`          | `generateId`, `formatSize`, `getOSIcon`, `playSuccessSound`, …                           |

---

## 7. Бэкенд (Rust): модули по зонам ответственности

### 7.1. Точка входа и общее состояние (`main.rs`, `lib.rs`, `state.rs`)

* `main.rs` — тонкая обёртка над `yassh_client_lib::run()`.
* `lib.rs` — сборка приложения: плагины (`single-instance`, `opener`, `dialog`,
  `clipboard-manager`, `updater`), состояние, `setup` (создание окна, старт MCP), список
  команд `generate_handler!`, поведение при закрытии окна (гашение SSH/SFTP/PTY/MCP) и
  отложенные задачи после первого показа (телеметрия, проверка обновлений, уборка
  временных каталогов, страховка показа окна, если рендерер не сообщил о готовности).
* `state.rs` — `AppState`: реестр SSH-сессий, SFTP-менеджер, состояние MCP, локальные
  терминалы, состояние апдейтера и окна. Управляется Tauri (`manage`), поэтому модули
  получают доступ через `AppHandle` и не держат глобальных переменных.
* `error.rs` — `AppError` и разбор ошибок в локализованные строки: фронтенд получает тот же
  формат, что и раньше, и показывает сообщение пользователю без изменений.

### 7.2. Окно (`window.rs`)

* Создаётся кодом, а не в `tauri.conf.json`: frameless (`decorations: false`), минимальный
  размер 800×500, размер по умолчанию 1277×911 (логические пиксели), геометрия и тема — из
  конфига.
* Размер и позиция применяются в билдере с учётом `scale_factor` целевого монитора, а перед
  первым показом `apply_startup_size()` подтверждает размер (окно скрыто, до трёх попыток):
  на Windows первый `set_size` попадает в ещё не декорированное окно, и tao прибавляет рамку
  с заголовком.
* `valid_bounds()` подрезает геометрию под рабочую область монитора, развёрнутое окно
  геометрию не сохраняет, запись идёт с дебаунсом 500 мс; размер сохраняется по
  `inner_size()`, позиция — по `outer_position()`.
* Показ окна привязан к готовности рендерера (`renderer-content-ready`), со страховкой по
  таймауту, чтобы окно не мигало белым.

### 7.3. Конфиг и хранилище секретов (`config.rs`, `vault.rs`, `keychain.rs`, `paths.rs`)

* `paths.rs` — пути и мелкие помощники: конфиг `~/.minissh_config.json` (совместим с
  прежним), каталог данных приложения, UUID, base64.
* `config.rs` — `AppConfig` / `SSHConfig`, загрузка с кэшем, атомарная запись, миграции
  (значения из конфига читаются и на frontend, и на бэкенде, поэтому **формат не меняем**).
  Источник правды для формы — `AppConfig` в `src/types.ts`, и **поле
  `favorites: SSHConfig[]` должно оставаться последним**.
* `vault.rs` — AES-256-GCM, мастер-ключ = `scrypt(recoveryKey, salt)`; recovery-ключ и соль
  лежат в конфиге. Формат зашифрованных секретов общий с прежней версией — бэкапы
  совместимы в обе стороны.
* `keychain.rs` — системное хранилище recovery-ключа (Credential Manager / Keychain /
  libsecret) для авторазблокировки; при недоступности ключ вводится вручную.
* Секреты `favorites` (пароли) вырезаются из конфига перед записью, приватные ключи
  хранятся только зашифрованными.

### 7.4. Приватные ключи (`keys.rs`)

Единая точка работы с ключами для SSH, SFTP, MCP и настроек:

* проверка формата содержимого (OpenSSH-контейнер, PKCS#8 с парольной фразой, PuTTY PPK);
* определение, зашифрован ключ или нет (нужно, чтобы вовремя спросить парольную фразу);
* расшифровка введённого в текущей сессии ключа и разбор в `russh::keys::PrivateKey`;
* миграция старого `privateKeyPath` → `privateKey` (путь читается, шифруется, путь
  удаляется; повторный запуск безопасен).

### 7.5. SSH (`ssh/`)

| Модуль      | Роль                                                                       |
|-------------|----------------------------------------------------------------------------|
| `auth.rs`   | план авторизации: ключ из сессии → пароль из сессии → ключ из конфига → пароль; `keyboard-interactive`; выбор хеш-алгоритма |
| `fingerprint.rs` | шлюз подтверждения отпечатка ключа хоста: `request`/`resolve`/`cancel`; общий для терминала, SFTP и проброса портов |
| `handler.rs`| реализация `russh::client::Handler` (в т.ч. `check_server_key`), ошибки авторизации |
| `session.rs`| установка соединения, каналы, shell/PTY, exec, вывод                        |
| `registry.rs`| реестр активных сессий, ввод/размер, перенаправление портов, `exec` для MCP, очистка |

Особенности, важные при доработках:

* ключ хоста проверяется в `check_server_key`: он совпадает с сохранённым в
  `favorites[id].fingerprint` — тогда соединение идёт молча, иначе рукопожатие
  прерывается, а отпечаток уходит в UI событием `ssh-fingerprint-${id}`;
  отпечаток принадлежит main-процессу, поэтому `save_config` восстанавливает его
  из кэша (`config::preserve_fingerprints`), а удаление идёт отдельной командой
  `ssh_clear_fingerprint`;
* подтверждение отпечатка проходит через `ssh::fingerprint` — терминал, SFTP и
  проброс портов висят на одном ожидании и отвечают одной командой
  `ssh_fingerprint_response`; решение принимается **внутри** подключения, а не
  переподключением, иначе SFTP и пересылка требовали бы «нажмите ещё раз»;
* окно подтверждения приходит **общим** событием `ssh-fingerprint`, а не
  `ssh-fingerprint-${id}`: Tauri допускает в имени события только буквы, цифры и
  `- / : _`, а идентификатор проброса портов — `forward:138.16.186.79:81`, где
  точка в адресе запрещена. `id` едет в payload, подписчик отбирает своё
  подключение. Остальные SSH-события остаются каналами по `id`: там
  идентификаторы — UUID, которые правилу удовлетворяют;
* хендл сессии лежит в `Arc<tokio::sync::Mutex<..>>`; блокировку не держат между `.await`,
  иначе теряется `Send`;
* `forward_start` гасит прежнее перенаправление с тем же ключом **до** `bind`, а accept-петля
  живёт в `tokio::select!` с веткой отмены — иначе слушатель переживал команду `stop`;
* перенаправление выполняется нативно (`TcpListener` + `russh`-канал), отдельное окно не
  создаётся, `PortForwardingView` открывается по прямой ссылке с параметрами.

### 7.6. SFTP (`sftp/`)

| Модуль       | Роль                                                                      |
|--------------|---------------------------------------------------------------------------|
| `session.rs` | менеджер SFTP: сессии (переиспользуют SSH-соединение), регистрация трансферов, отмена, классификация ошибок |
| `files.rs`   | операции над файлами: readdir, mkdir, rm, rename, chmod, realpath         |
| `transfer.rs`| загрузка/скачивание (прежний worker → задачи tokio), загрузка по путям и потоком, `openInEditor/With`, наблюдение за изменением файла |
| `progress.rs`| агрегат прогресса и прореживание событий (один отчёт в 100 мс)            |
| `archive.rs` | команды распаковки архивов на сервере                                    |
| `utils.rs`   | помощники: нормализация путей, экранирование, классификация файлов        |

Загрузка идёт во временный путь, затем переименование в целевой (с разрешением коллизий);
жизненный цикл трансфера — состояния `ACTIVE/COMPLETING/CANCELLING`, отмена — флаг
активности. Сканирование изменённого файла сделано опросом метаданных раз в 500 мс
(вместо `fs.watch`, чтобы не тянуть платформенные зависимости).

### 7.7. Локальный терминал (`local_terminal.rs`)

`portable-pty`: на Windows — ConPTY, на Unix — системный pty. Определение оболочки,
привязка сессии к окну, команды `local-terminal-start/input/resize/close`, вывод в
`local-terminal-output-<id>`, завершение — в `local-terminal-exit-<id>`.

### 7.8. MCP-сервер (`mcp.rs`)

MCP over **Streamable HTTP**: один сервер на `127.0.0.1:<mcpPort>`, endpoint строго
`POST /mcp`, авторизация `Authorization: Bearer <mcpToken>` (сравнение без тайминга).

* лимиты: тело запроса до 1 МБ, подтверждение команды 5 минут, выполнение команды 2 минуты,
  сессия агента простаивает 30 минут, в отчёте не больше 20 агентов, буфер журнала 500 записей;
* инструменты: `list_connections` и `execute_command`;
* поток команды: начало вызова → (если включено) подтверждение пользователя → повторная
  проверка авторизации → выполнение в отдельном SSH-соединении → финализация и событие
  `mcp-log`;
* журнал: `buffer_log` пишет запись только пока вкладка MCP видима, иначе буфер не растёт;
  вкладка при открытии запрашивает историю (`mcp-get-logs`) и дополняет её живыми
  событиями, поэтому журнал не пустеет, если вкладку закрыли на время работы агента.

### 7.9. Обновления (`updates.rs`)

`tauri-plugin-updater` поверх собственных JSON-манифестов: `latest.json`
(стабильный канал) и `prerelease.json` (канал pre-release). Плагин не умеет
отсекать пре-релизы, поэтому канал выбирается явно — по настройке
`AppConfig.allow_pre_release_updates`, а версия-пре-релиз дополнительно
отбрасывается при выключенной настройке (при поиске и перед установкой).
Ключевые решения (в отличие от «просто скачать и запустить»):

1. **проверка подписи на клиенте** — файл и манифест проверяются minisign-ключом из
   `tauri.conf.json`, до запуска установщика;
2. **проверка версии без доверия к серверу** — сравнение semver-подобное
   (`is_newer_version`), релиз новее своей пре-релизной сборки;
3. **фоновая проверка не чаще раза в 6 часов** — состояние хранится в файле, а не только в
   памяти;
4. **запрет даунгрейда**.

События: `update-status`, `update-available`, `update-progress`, `update-error`; управление
из UI — через `useUpdateChecker`.

### 7.10. Логи и санитизация (`logger.rs`, `sanitize.rs`)

`logger.rs` пишет в кольцевой буфер (2000 записей) и в stderr; сообщения рендерера
приходят командой `log-renderer-msg`. `sanitize.rs` вырезает приватные ключи, Bearer-токены
(с сохранением префикса `Bearer `) и значения чувствительных параметров; правила совпадают с
`src/utils/logSanitizer.ts`. Экспорт логов — командой `export-logs`.

### 7.11. Системные мелочи

* `i18n.rs` + `i18n/main.json` — словарь бэкенда; ключи совпадают с фронтендовыми, тест
  `ключи_ru_и_en_совпадают` следит за их целостностью.
* `telemetry.rs` — фоновый отчёт при запуске: только обезличенные поля (версия, платформа,
  архитектура, количество избранных, включён ли MCP, тема, язык, идентификатор установки).
  Хосты, имена серверов, логины и ключи не отправляются.

---

## 8. Данные и локализация

### 8.1. `AppConfig` (`src/types.ts`)

Все пользовательские настройки в одном объекте: тема, шрифты, язык, положение окна,
вкладки/вьеты, настройки терминала/SFTP/MCP, vault-поля, `favorites: SSHConfig[]`.
Секреты (`password`) в `favorites` **не хранятся** — они в `encryptedPasswords[serverId]`.
Приватные ключи хранятся в `favorites[i].privateKey` **только в зашифрованном виде**.

### 8.2. Локализация

Два словаря с одинаковыми ключами: `src/utils/translations.ts` (интерфейс) и
`src-tauri/i18n/main.json` (сообщения бэкенда). Ключ — точечный путь:
`t('sftp.rename')` надёжнее, чем хардкод строк. Языки: `ru`, `en`; новые строки
добавляются в обе ветви обоих словарей.

### 8.3. `SSHConfig.id` как якорь

`id` сервера связывает: favorite в конфиге, записи vault (`encryptedPasswords[id]`),
разрешённые MCP (`mcpAllowedServerIds`). При удалении сервера чистятся все три.

---

## 9. «Навигатор по задачам» — куда смотреть при изменениях

| Если нужно…                                     | Смотреть в                                                                 |
|-------------------------------------------------|-----------------------------------------------------------------------------|
| Добавить пункт в настройки                      | `views/SettingsView.tsx` + секции `views/settings/`                         |
| Изменить текст UI                               | `src/utils/translations.ts`                                                 |
| Изменить текст сообщения бэкенда                | `src-tauri/i18n/main.json`                                                  |
| Найти/добавить команду IPC                      | `commands.rs` / `commands_sftp.rs` ↔ `generate_handler!` в `lib.rs` ↔ `tauri-bridge.ts` |
| Найти типы payload'ов                           | `src/ipc/*.ts`, `src/types.ts`                                              |
| Разобраться с терминалом (xterm)                | `src/components/Terminal.tsx` (SSH) и `LocalTerminal.tsx` (локальный)       |
| Экраны соединения в терминале, reconnect        | тот же `Terminal.tsx` (overlay, `retryKey`)                                 |
| Починить подключение SSH (медленный ввод/фризы) | `ssh/registry.rs`, `ssh/session.rs`                                         |
| Авторизация (пароль, ключ, passphrase, KbdInt)  | `ssh/auth.rs`, `ssh/handler.rs`, `keys.rs`                                   |
| Отпечаток ключа хоста (подтверждение)          | `ssh/handler.rs` (`check_server_key`), `ssh/fingerprint.rs` (шлюз), `config.rs` |
| Перенаправление портов                           | `ssh/registry.rs` (`forward_start`/`forward_stop`, `ForwardServer`)          |
| SFTP: соединение / каталоги / права / удаление  | `sftp/session.rs`, `sftp/files.rs` + `hooks/sftp/*`                          |
| SFTP: загрузка/скачивание, отмена                | `sftp/transfer.rs`, `sftp/session.rs` (трансферы)                           |
| SFTP: прогресс                                   | `sftp/progress.rs` (бэкенд) + `useSftpTransfers.ts`, `SftpTransferPanel.tsx` |
| Локальный терминал                               | `local_terminal.rs` + `src/components/LocalTerminal.tsx`                    |
| MCP-сервер / подтверждения / таймлайн           | `src-tauri/src/mcp.rs` + `src/components/McpTab.tsx`                        |
| Vault / пароли / recovery-ключ                   | `vault.rs`, `keychain.rs`, команды `vault-*`, модалки `Vault*Modal.tsx`     |
| Конфиг / миграции / дефолты                     | `config.rs` + `AppConfig` в `src/types.ts`                                   |
| Окно: геометрия, показ, тайтлбар                 | `window.rs` + `layout/TitleBar.tsx`                                          |
| Обновления / автоапдейт                         | `updates.rs` + `hooks/useUpdateChecker.ts` + `docs/UPDATER.md`               |
| Темы и цвета терминала                          | `src/styles/*.css`, `src/utils/theme.ts`                                     |
| Шрифты                                          | `public/fonts/` + `@font-face` в CSS (пути БЕЗ `./`-префикса), регистрация в `useSystemFonts` |
| Иконки приложения                               | `public/icons/` (TitleBar — icon48, Settings — icon256), бандл — `npm run icons:tauri` |
| Логирование / экспорт логов                     | `logger.rs`, `sanitize.rs`, `src/utils/rendererLogger.ts`                   |
| Сборка / релизы / установщик                     | `src-tauri/tauri.conf.json`, `scripts/*`, `.github/workflows/build-tauri.yml`, `docs/UPDATER.md` |

---

## 10. Соглашения и незыблемые правила

1. **`Terminal.tsx`**: `lineHeight` xterm **всегда = 1**; `fitAddon.fit()` выполняется
   **до** установки SSH-соединения.
2. **Типизация**: без `any`/`unknown` в новом коде, strict mode.
3. **Локализация**: UI и сообщения — ru **и** en; общение с пользователем в чате — на
   русском; PR и коммиты — на русском.
4. **Версии**: поднимать максимум `+0.0.1` за сессию (если явно не указано иначе) и
   синхронно в `package.json`, `package-lock.json`, `src/types.ts`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`; `releaseType: draft` в `package.json`
   менять запрещено.
5. **Тесты**: `npm run test` (`cargo test`) должен проходить. Новый тест кладём в
   `src-tauri/src/tests/`, а не внутрь рабочего модуля, и подключаем через
   `#[path = "tests/<имя>.rs"] mod tests;`.
6. **Шрифты**: не удалять из `public/fonts/`, не убирать из `@font-face`, пути без `./`.
7. **AppConfig**: поле `favorites: SSHConfig[]` всегда в конце.
8. **Мусор**: не оставлять `tsconfig*.tsbuildinfo` и т.п. артефакты сборки.
9. **Безопасность**: секреты не логировать (`sanitize.rs` + `logSanitizer.ts`); новые
   команды — строго через контракт `IpcRendererApi`; права webview не расширять без нужды.
