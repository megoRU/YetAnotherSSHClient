# Архитектура YetAnotherSSHClient

Данный документ описывает общую архитектуру приложения: процессы, модули, межпроцессное
взаимодействие (IPC) и отвечает на вопрос «где что лежит и как это найти».

## 1. Обзор

**YetAnotherSSHClient** — кроссплатформенное (Windows / Linux / macOS) десктопное приложение
для работы с SSH. Стек:

| Слой       | Технологии                                                       |
|------------|------------------------------------------------------------------|
| UI         | React 19, TypeScript (strict), Vite 7                            |
| Shell      | Electron 43                                                      |
| SSH        | `ssh2` (клиент SSH/SFTP), `node-pty` (локальный терминал/PTY)    |
| Terminal   | `@xterm/xterm` + аддоны `fit`, `webgl`, `web-links`, `clipboard` |
| MCP        | `@modelcontextprotocol/sdk` (Streamable HTTP)                    |
| Обновления | `electron-updater` (GitHub Releases)                             |

Ключевые возможности: SSH-терминал во вкладках, SFTP-браузер с передачами в отдельном
worker-процессе, порт-форвардинг, локальный терминал, MCP-сервер для ИИ-агентов,
хранилище паролей (vault), автообновления, темы и i18n (ru/en).

---

## 2. Процессы и границы

Приложение состоит из **трёх процессов**:

```
┌────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS  (electron/)                                         │
│  • жизнь окна, окно, IPC-хендлеры                                  │
│  • SSH/SFTP/порт-форвардинг (ssh2)                                 │
│  • локальный терминал (node-pty)                                   │
│  • MCP-сервер, vault, конфиг, обновления, логи                     │
└───────────────┬──────────────────────────▲─────────────────────────┘
                │  contextBridge / IPC     │
┌───────────────▼──────────────────────────┴─────────────────────────┐
│  PRELOAD  (electron/preload.ts)                                    │
│  • единственный мост: window.ipcRenderer → main                    │
│  • безопасно: contextIsolation=true, nodeIntegration=false,        │
│    sandbox=true                                                    │
└───────────────▲──────────────────────────┴─────────────────────────┘
                │  window.ipcRenderer      │
┌───────────────┴──────────────────────────▲─────────────────────────┐
│  RENDERER  (src/)                                                  │
│  • React UI, состояние, вкладки                                    │
│  • не имеет доступа к Node.js — только типизированный IPC          │
└────────────────────────────────────────────────────────────────────┘

Отдельный ОТДЕЛЬНЫЙ utilityProcess:
┌────────────────────────────────────────────────────────────────────┐
│  SFTP TRANSFER WORKER (electron/src/sftp/worker/…)                 │
│  • тяжёлые передачи fastPut/fastGet в выносе из main-потока        │
└────────────────────────────────────────────────────────────────────┘
```

Правило безопасности: **весь доступ рендерера к Node.js — только через `preload.ts` и
типизированный интерфейс `IpcRendererApi`** (см. раздел «IPC»).

---

## 3. Структура репозитория

```text
YetAnotherSSHClient/
├── electron/                    # MAIN PROCESS
│   ├── main.ts                  # точка входа: окно, жизненный цикл, ошибки, IPC
│   ├── preload.ts               # мост contextBridge (window.ipcRenderer)
│   ├── installer.nsh            # NSIS-хелперы для electron-builder
│   └── src/                     # модули основного процесса
│       ├── config.ts            # ~/.minissh_config.json: загрузка/сохранение, миграции
│       ├── vault.ts             # AES-256-GCM шифрование паролей (scrypt ключ)
│       ├── i18n-main.ts         # переводы в main (тот же словарь, что в renderer)
│       ├── logger.ts            # перехват console.* + кольцевой буфер логов
│       ├── theme-utils.ts       # цвет фона окна по теме
│       ├── ssh-manager.ts       # реестры ssh/sftp/сокетов/форвардов + cleanup
│       ├── ipc-handlers.ts      # ВСЕ IPC-хендлеры (Registry)
│       ├── local-terminal.ts    # локальный PTY-терминал (node-pty)
│       ├── update-service.ts    # автообновления (electron-updater)
│       ├── mcp-server.ts        # обёртка, экспортирующая точку входа MCP
│       ├── mcp/                 # MCP-сервер (см. раздел 7)
│       └── sftp/                # SFTP: соединение, файлы, передачи, worker
│           ├── SftpManager.ts           # фасад (singleton)
│           ├── SftpConnection.ts        # SSH/SFTP handshake, реюз соединений
│           ├── SftpFileService.ts       # readdir/mkdir/rm/rename/chmod/realpath
│           ├── SftpUploadService.ts     # загрузка через worker + promote temp
│           ├── SftpDownloadService.ts   # скачивание, openInEditor/With, fs.watch
│           ├── SftpArchiveService.ts    # распаковка архивов на сервере
│           ├── SftpTransferManager.ts   # lifecycle трансферов (ACTIVE/COMPLETING/…)
│           ├── sftp-transfer-*.ts       # общие утилиты, прогресс-батчер, worker-клиент
│           └── worker/sftp-transfer-worker.ts  # utilityProcess для передач
│
├── src/                        # RENDERER (React)
│   ├── main.tsx                # точка входа, initRendererLogger
│   ├── App.tsx                 # корневой компонент, вкладки, модалки, глобальные состояния
│   ├── App.css / index.css     # базовые стили
│   ├── global.d.ts             # объявление window.ipcRenderer
│   ├── types.ts                # общие типы (AppConfig, SSHConfig, Tab, Sftp*, MCP…)
│   ├── ipc/                    # ТИПЫ + ДОГОВОР IPC-каналов (см. раздел 5)
│   │   ├── index.ts            # barrel всех типов
│   │   ├── renderer-api.ts     # интерфейс IpcRendererApi (главный контракт)
│   │   ├── ssh.ts / sftp.ts / mcp.ts / system.ts / update.ts / vault.ts
│   ├── components/             # UI-компоненты (см. раздел 6)
│   ├── hooks/                  # хуки (см. раздел 6)
│   │   └── sftp/               # хуки SFTP: соединение, каталог, выделение, трансферы
│   ├── styles/                 # темы xterm + CSS: dark/light/gruvbox/windows-terminal
│   └── utils/                  # утилиты (см. раздел 6)
│
├── public/
│   ├── fonts/                  # TTF-шрифты (регистрируются @font-face в CSS!)
│   ├── icons/                  # иконки приложения (+ icons/os для дистрибутивов)
│   └── sound/                  # звуки (success.wav)
│
├── images/                     # скриншоты для README
├── docs/ARCHITECTURE.md        # этот документ
├── package.json                # скрипты, зависимости, конфиг electron-builder
├── vite.config.ts              # сборка renderer + electron + worker
├── electron-builder конфиг     # в package.json "build"
└── .github/workflows/build.yml # CI: сборка и публикация релизов (push в main)
```

---

## 4. Ключевые скрипты и сборка

| Команда                                         | Что делает                         |
|-------------------------------------------------|------------------------------------|
| `npm run dev`                                   | dev-режим (Vite + Electron)        |
| `npm run build`                                 | сборка renderer/renderer (`dist/`) |
| `npm run lint`                                  | eslint                             |
| `npm run package`                               | `build` + electron-builder         |
| `npm run package:win:x64` / `package:win:arm64` | сборка Windows NSIS-установщика    |

Три точки сборки в `vite.config.ts`:
1. **main** — `electron/main.ts` (внешние модули: `ssh2`, `node-pty`, `electron-updater`…),
2. **preload** — `electron/preload.ts` (только `electron` во внешних),
3. **worker** — `electron/src/sftp/worker/sftp-transfer-worker.ts` (отдельная группа
   с `onstart: () => {}`, чтобы dev не спавнил второй инстанс Electron).

CI (`build.yml`): на push в `main` собирает и публикует релизы на 3 ОС
(ubuntu-24.04 / windows-latest / macos-26) с `npm run package -- --publish always`.
`releaseType: draft` в `package.json` — черновики релизов, менять запрещено.

---

## 5. IPC — межпроцессное взаимодействие

### 5.1. Договор (contract)

| Файл                           | Роль                                                       |
|--------------------------------|------------------------------------------------------------|
| `src/ipc/renderer-api.ts`      | **Единственный контракт**: тип `IpcRendererApi`            |
| `electron/preload.ts`          | реализует контракт через `contextBridge.exposeInMainWorld` |
| `src/global.d.ts`              | `window.ipcRenderer: IpcRendererApi`                       |
| `electron/src/ipc-handlers.ts` | **единственный** регистратор всех `ipcMain.on/handle`      |
| `src/ipc/*.ts`                 | типы payload'ов/результатов по доменам                     |

> Если нужно добавить новое IPC-действие: обнови интерфейс в
> `src/ipc/renderer-api.ts` + реализацию в `electron/preload.ts` + обработчик в
> `electron/src/ipc-handlers.ts`. Запросы — `ipcRenderer.invoke`, явления без ответа —
> `ipcRenderer.send`, синхронные — `sendSync` (только `get-config-sync`).

### 5.2. Соглашение об именовании каналов

- **Команды** (renderer → main): домен-префикс + действие, напр. `ssh-connect`,
  `sftp-readdir`, `mcp-toggle`, `check-updates`, `window-minimize`.
- **События-ответы** (main → renderer): `домен-событие-<sessionId>`. SessionId
  генерируется в renderer (`generateId()` / `Math.random()`) и уникален для вкладки,
  поэтому одна вкладка не читает чужие события.
  Примеры: `ssh-output-<id>`, `ssh-status-<id>`, `ssh-error-<id>`,
  `sftp-transfer-start-<id>`, `sftp-progress-<id>`, `local-terminal-output-<id>`,
  `local-terminal-exit-<id>`.
- **Глобальные события** (main → renderer, без id): `update-status`,
  `update-available`, `update-progress`, `mcp-status-changed`, `mcp-log`,
  `mcp-request-confirmation`, `window-maximized-state`, `app-reload-request`.

Клиентская подписка всегда через метод из контракта: `onSSHOutput(id, cb)`,
`onSFTPStatus(id, cb)` и т.д. — прямой `ipcRenderer.on` в компонентах не используем.

### 5.3. Оптимизация производительности

- **SSH-вывод** батчится в main: `queueOutputChunk/flushOutputBatch` (флаш по 64 КБ
  или через `setImmediate`), в renderer — очередь с rAF/таймером.
- **SFTP-прогресс** троттлится: `SftpProgressBatcher` (main) ≤ 1 IPC / 100 мс и
  `ProgressStore` (renderer, `useSyncExternalStore`).

---

## 6. Рендерер (React): компоненты, хуки, утилиты

### 6.1. Компоненты (`src/components`)

| Компонент                       | Назначение / IPC                                                                                                                                                             |
|---------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Terminal.tsx`                  | SSH-терминал. **Пайплайн: font → term.open → rAF → fitAddon.fit() → sshConnect**; `onSSHOutput/onSSHStatus/onSSHError/onSSHOSInfo`. Аддоны: fit, webgl, web-links, clipboard |
| `LocalTerminal.tsx`             | Локальный PTY (node-pty). handshake `localTerminalStart` (invoke) + события `local-terminal-output/exit`                                                                     |
| `SFTPBrowser.tsx`               | SFTP-вкладка: каталоги, файлы, трансферы, drag&drop. Вся логика вынесена в `hooks/sftp/*`                                                                                    |
| `ConnectionForm.tsx`            | форма создания/редактирования подключения (вставка/загрузка приватного ключа, `encryptPrivateKey`)                                                                       |
| `McpTab.tsx`                    | вкладка MCP для сервера: статус, агенты, подтверждения, таймлайн (`onMcpStatusChanged/onMcpLog/onMcpRequestConfirmation`)                                                    |
| `layout/TitleBar.tsx`           | кастомный тайтлбар, вкладки, drag-drop, кнопки окна                                                                                                                          |
| `layout/Sidebar.tsx`            | список избранных серверов + поиск                                                                                                                                            |
| `layout/ContextMenu.tsx`        | портальное контекстное меню                                                                                                                                                  |
| `layout/CustomSelect.tsx`       | кастомный селект                                                                                                                                                             |
| `layout/ErrorBoundary.tsx`      | предохранитель React                                                                                                                                                         |
| `views/HomeView.tsx`            | карточки серверов, поиск, баннер лицензии                                                                                                                                    |
| `views/SettingsView.tsx`        | корень настроек (11 секций), импорт/экспорт, логи, vault                                                                                                                     |
| `views/OnboardingView.tsx`      | 3-шаговый онбординг                                                                                                                                                          |
| `views/PortForwardingView.tsx`  | SSH-порт-форвардинг (sshForwardStart/Stop)                                                                                                                                   |
| `views/support/SupportView.tsx` | поддержка, лицензия, спонсоры (внешний HTTP-API)                                                                                                                             |
| `modals/*.tsx`                  | VaultUnlock/RecoveryKey/Delete/Notification/Toast                                                                                                                            |
| `sftp/*.tsx`                    | SftpToolbar, SftpFileList, SftpTransferPanel, SftpModals                                                                                                                     |

### 6.2. Хуки (`src/hooks`)

| Хук                      | Назначение / IPC                                                     |
|--------------------------|----------------------------------------------------------------------|
| `useConfig.ts`           | глобальный конфиг (`getConfigSync`/`saveConfig`) с миграцией и темой |
| `useTabs.ts`             | стейт вкладок (без IPC)                                              |
| `useSystemFonts.ts`      | статический список системных шрифтов                                 |
| `useUpdateChecker.ts`    | мониторинг обновлений (все `onUpdate*`)                              |
| `useGlobalShortcuts.ts`  | глобальные горячие клавиши (Ctrl+W/Tab/…)                            |
| `hooks/sftp/useSftp*.ts` | соединение, события, каталог, выбор, трансферы, file-changed         |

### 6.3. Утилиты (`src/utils`)

| Утилита             | Роль                                                                                                           |
|---------------------|----------------------------------------------------------------------------------------------------------------|
| `i18n.ts`           | резолвер `t('path.to.key')` (подстановка `{param}`)                                                            |
| `translations.ts`   | словари `ru`/`en` (секции: common, tabs, sftp, mcp, …). **Общий словарь для renderer и main (`i18n-main.ts`)** |
| `privateKey.ts`     | `looksLikePrivateKey` — валидация содержимого приватного ключа (PEM / PPK)                                     |
| `theme.ts`          | 16 ANSI-цветов xterm для каждой темы                                                                           |
| `shortcuts.ts`      | матчеры горячих клавиш, `isEditableInput`                                                                      |
| `fontLoader.ts`     | `ensureTerminalFont` — предзагрузка TTF через Font API                                                         |
| `license.ts`        | валидация лицензии через `https://api.megoru.ru/api/license`                                                   |
| `logSanitizer.ts`   | санитизация секретов в логах (пароли, Bearer, ключи)                                                           |
| `rendererLogger.ts` | мост `console.*` рендерера → `log-renderer-msg`                                                                |
| `index.ts`          | `generateId`, `formatSize`, `getOSIcon`, `playSuccessSound`, …                                                 |

---

## 7. Основной процесс (main): модули по зонам ответственности

### 7.1. Конфиг и vault (`config.ts`, `vault.ts`)

- Конфиг: `~/.minissh_config.json` (Windows/macOS/Linux — в домашней директории).
  Загрузка с кэшем, запись — атомарная через tmp+rename с очередью (`saveQueue`),
  пароли из `favorites` всегда вырезаются перед записью.
  Единственный источник правды полей — `AppConfig` в `src/types.ts`
  (**и поле `favorites: SSHConfig[]` должно оставаться последним**).
- Vault: пароли и приватные ключи шифруются **AES-256-GCM**; мастер-ключ =
  `scryptSync(recoveryKey, salt, 32)`. Recovery-ключ и соль хранятся в конфиге,
  ключ может дублироваться через `safeStorage` (ОС) для авто-разблокировки.
  `initializeVaultAndMigrate` — фоновая миграция устаревших конфигов.
- Приватные ключи хранятся прямо в `favorites[i].privateKey` (`EncryptedSecret`,
  только зашифрованными). Legacy-поле `privateKeyPath` мигрируется автоматически
  (`migratePrivateKeyPaths`: есть путь → прочитать → зашифровать → удалить путь;
  путь без ключа и недоступный файл — не удаляются, повторный запуск безопасен).

### 7.2. SSH / SFTP / форвардинг (`ssh-manager.ts`, `ipc-handlers.ts`, `sftp/`)

- **ssh-manager.ts** — центральный реестр по `sessionId`: `sshClients`, `sshSockets`,
  `shellStreams`, `sftpClients`, `sftpWatchers`, `forwardServers`, `sshConfigs`;
  функции `cleanupConnection(id)` и `cleanupAll()`.
- **IP-адреса соединений**:
  - SSH-подключение: `ipc-handlers.ts` → блок `ssh-connect` (TCP socket → `ssh2.Client`
    → `shell()` + pty). Пароли: vault при `id`, иначе `config.password`. Ключи:
    зашифрованный в vault `SSHConfig.privateKey` (legacy-`privateKeyPath`
    поддерживается до миграции); резолв — `electron/src/private-key.ts`.
  - SFTP: `SftpConnectionService.connect` (реюз живого SSH-клиента той же сессии,
    классфикация ошибок `SftpErrorKind`). Файловые операции — `SftpFileService`.
  - Порт-форвардинг: `ssh-forward-start/stop` → `net.createServer` + `client.forwardOut`.
- **Передачи (upload/download)** вынесены в `utilityProcess`
  (`sftp-transfer-worker`): `fastPut/fastGet` с `concurrency:16`; загрузка идёт во
  временный `.uploading-<id>` путь, затем `promoteRemotePath` (temp → target, с коллизиями).
  Lifecycle и отмена — `SftpTransferManager` (состояния `ACTIVE/COMPLETING/CANCELLING`),
  клиент событий — `SftpTransferWorkerClient`.

### 7.3. Локальный терминал (`local-terminal.ts`)

- `node-pty`: определение системной оболочки (`resolveSystemShell`), ленивый require
  самом нативного модуля, fallback'и для macOS. Сессии привязаны к владельцу
  (`webContentsId`), уничтожаются при гибели/перезагрузке renderer'а.
- Контракт: `local-terminal-start` (invoke), `-input`, `-resize`, `-close` (send);
  события `local-terminal-output-<id>`, `local-terminal-exit-<id>`.

### 7.4. MCP-сервер (`mcp/`)

MCP over **Streamable HTTP**: один `http.Server` на `127.0.0.1:<mcpPort>`, endpoint
строго `POST /mcp`, авторизация `Authorization: Bearer <mcpToken>` (timing-safe).

| Модуль                       | Роль                                                         |
|------------------------------|--------------------------------------------------------------|
| `server.ts`                  | HTTP-сервер, lifecycle (старт/стоп/sync с конфигом)          |
| `jsonrpc-handler.ts`         | создание `McpServer` SDK-экземпляра с тулами                 |
| `session-manager.ts`         | сессии агентов, inactivity-тайм-аут (5 мин)                  |
| `confirmation-manager.ts`    | «ворота» подтверждений команд (таймаут 5 мин, revoke)        |
| `execution-manager.ts`       | реестр запусков + `AbortSignal` для отмены                   |
| `timeline-manager.ts`        | «run» агента: `mcp-log` kind=start/tool_call/tool_result/end |
| `ssh-executor.ts`            | изолированное выполнение команды (120 c, отмена)             |
| `execute-command-service.ts` | оркестрация тула `execute_command`                           |
| `tools/`                     | регистрация тулов `execute_command`, `list_connections`      |

Поток команды: `beginToolCall` → await подтверждения пользователя (если
`mcpRequireConfirmation`) → повторная проверка авторизации → `ssh-executor` →
`finishToolExecution` (единственная точка финализации). Обновления UI идут событиями
`mcp-status-changed`, `mcp-log`, `mcp-request-confirmation`.

### 7.5. Обновления (`update-service.ts`)

`electron-updater` (GitHub), `autoDownload=false`. Проверка — максимум раз в сутки
(поле `lastUpdateCheck`), запрет даунгрейда (`isVersionNewer`), для macOS отключена.
События: `update-status`, `update-available` (с release notes из GitHub API),
`update-progress`, `update-error`. Управление из UI — через `useUpdateChecker`.

### 7.6. Логирование (`logger.ts`, `rendererLogger.ts`, `logSanitizer.ts`)

`logger.ts` перехватывает `console.*` main-процесса в кольцевой буфер (2000 записей),
`rendererLogger.ts` аналогично в рендерере с отправкой через `log-renderer-msg`.
Все сообщения проходят `sanitizeText`/`formatArg` (секреты вырезаются). Экспорт логов —
`export-logs` (dialog + `generateLogExportText`).

---

## 8. Данные и локализация

### 8.1. `AppConfig` (src/types.ts)

Все пользовательские настройки в одном объекте: тема, шрифты, язык, положение окна,
вкладки/вьеты, настройки терминала/SFTP/MCP, vault-поля, `favorites: SSHConfig[]`.
Секреты (`password`) в `favorites` **не хранятся** — они в `encryptedPasswords[serverId]`.
Приватные ключи хранятся в `favorites[i].privateKey` **только в зашифрованном виде**.

### 8.2. Локализация

Один словарь `translations.ts` используется и в renderer, и в main (`i18n-main.ts`).
Ключ — точечный путь: `t('sftp.rename')` надёжнее не хардкодить строки в UI.
Языки: `ru`, `en`. Новые строки добавляются в обе языковые ветки.

### 8.3. `SSHConfig.id` как якорь

`id` сервера связывает: favorite в конфиге, записи vault (`encryptedPasswords[id]`),
разрешённые MCP (`mcpAllowedServerIds`). При удалении сервера стоит чистить все три.

---

## 9. «Навигатор по задачам» — куда смотреть при изменениях

| Если нужно…                                     | Смотреть в                                                                                    |
|-------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Добавить пункт в настройки                      | `views/SettingsView.tsx` + секции в `components/views/settings/`                              |
| Изменить текст UI                               | `src/utils/translations.ts`                                                                   |
| Найти все IPC-действия                          | `electron/src/ipc-handlers.ts` (main) ↔ `electron/preload.ts` (мост)                          |
| Найти типы payload'ов                           | `src/ipc/*.ts`, `src/types.ts`                                                                |
| Разобраться с терминалом (xterm)                | `src/components/Terminal.tsx` (SSH) и `LocalTerminal.tsx` (локальный)                         |
| Экраны соединения в терминале, reconnect        | тот же `Terminal.tsx` (overlay, `retryKey`)                                                   |
| Починить подключение SSH (медленный ввод/фризы) | `ssh-connect` и батчинг в `ipc-handlers.ts`                                                   |
| SFTP: соединение / каталоги / права / удаление  | `SftpConnection.ts`, `SftpFileService.ts` + `hooks/sftp/*`                                    |
| SFTP: загрузка/скачивание (worker)              | `SftpUploadService/SftpDownloadService`, `sftp-transfer-worker.ts`, `SftpTransferManager.ts`  |
| SFTP: прогресс-бар                              | `sftp-progress-batcher.ts` (main), `useSftpTransfers.ts` + `SftpTransferPanel.tsx` (renderer) |
| Local terminal (PTY)                            | `electron/src/local-terminal.ts` + `src/components/LocalTerminal.tsx`                         |
| MCP-сервер / подтверждения / таймлайн           | `electron/src/mcp/*` + `src/components/McpTab.tsx`                                            |
| Vault / пароли                                  | `electron/src/vault.ts`, IPC `vault-*` в `ipc-handlers.ts`, модалки `Vault*Modal.tsx`         |
| Конфиг / миграции / дефолты                     | `electron/src/config.ts` + `AppConfig` в `src/types.ts`                                       |
| Обновления / автоапдейт                         | `electron/src/update-service.ts` + `hooks/useUpdateChecker.ts`                                |
| Управление окном (тайтлбар, состояние)          | `electron/main.ts:createWindow` + `layout/TitleBar.tsx`                                       |
| Темы и цвета терминала                          | `src/styles/*.css`, `src/utils/theme.ts`, `electron/src/theme-utils.ts`                       |
| Шрифты                                          | `public/fonts/` + `@font-face` в CSS (пути БЕЗ `./`-префикса), регистрация в `useSystemFonts` |
| Иконки приложения                               | `public/icons/` (TitleBar — icon48, Settings — icon256)                                       |
| Логгирование / экспорт логов                    | `electron/src/logger.ts`, `src/utils/logSanitizer.ts`, `rendererLogger.ts`                    |
| Сборка / релизы / установщик                    | `package.json` (build), `vite.config.ts`, `.github/workflows/build.yml`                       |

---

## 10. Соглашения и незыблемые правила

1. **`Terminal.tsx`**: `lineHeight` xterm **всегда = 1**; `fitAddon.fit()` выполняется
   **до** установки SSH-соединения.
2. **Типизация**: без `any`/`unknown` в новом коде, strict mode.
3. **Локализация**: UI и сообщения — ru **и** en через словарь. Общение с пользователем
   в чате — на русском; PR и коммиты — на русском.
4. **Версии**: поднимать максимум `+0.0.1` за сессию (если явно не указано иначе),
   `releaseType: draft` менять запрещено.
5. **Тесты**: автоматические/интеграционные тесты в проект не добавлять.
6. **Шрифты**: не удалять из `public/fonts/`, не убирать из `@font-face`, пути без `./`.
7. **AppConfig**: поле `favorites: SSHConfig[]` всегда в конце.
8. **Мусор**: не оставлять `tsconfig.node.tsbuildinfo` и т.п. артефакты.
9. **Безопасность**: секреты не логировать (есть `logSanitizer.ts`), новые IPC-вызовы
   — строго через контракт `IpcRendererApi`.