/**
 * Мост между renderer и Tauri.
 *
 * Реализует ровно тот интерфейс `IpcRendererApi`, который раньше предоставлял
 * `contextBridge` в preload-скрипте Electron-версии, поэтому React-код не
 * меняется: компоненты продолжают обращаться к `window.ipcRenderer`.
 *
 * Что здесь неочевидно и почему так сделано:
 *
 * 1. `getConfigSync()` обязан быть синхронным — `useConfig` читает конфиг до
 *    первого `await`. Снимок конфига подставляется в webview скриптом
 *    инициализации (`window.__YASSH_BOOTSTRAP__`), который выполняется до
 *    загрузки приложения. Так же поступил бы и Electron: там синхронный
 *    `ipcRenderer.sendSync` блокировал бы поток рендерера.
 * 2. События приходят через `listen` с теми же именами каналов, что и в
 *    Electron (`ssh-status-${id}`, `mcp-log`, …), поэтому подписчики в
 *    компонентах не меняются.
 * 3. Вывод терминалов (`sshConnect`, `localTerminalStart`) идёт каналом
 *    `Channel<ArrayBuffer>` — сырые байты без base64 и событий.
 * 4. `Ctrl+R`/`F5` перехватываются в DOM (capture-фаза), а не в main-процессе:
 *    в Tauri нет аналога `before-input-event`, а `preventDefault` в webview
 *    надёжно отменяет перезагрузку. Событие `app-reload-request` уходит в
 *    компоненты тем же способом, что и раньше.
 * 5. В Tauri native drag&drop передаёт пути отдельным событием. WebView2 не
 *    гарантирует DOM `File` для native dropped files, поэтому пути обрабатываются
 *    напрямую, без сопоставления с `DataTransfer`.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { installLostCallbackFilter } from './tauriWarnings.js'
import type { IpcRendererApi } from './index.js'
import type { AppConfig, SftpErrorEvent, SftpStatusEvent, UpdateStatus } from '../types.js'
import type { SshAuthChallenge, SshAuthResponse, SshFingerprintChallenge, SshInputPayload, SshResizePayload, SshConnectPayload, SshForwardStartPayload } from './ssh.js'
import type { SftpTransferStartEvent, SftpFileChangedEvent, SftpProgress } from './sftp.js'
import type { McpConfirmCommandPayload, McpConfirmationRequest, McpLogItem, McpStatus } from './mcp.js'
import type { CheckUpdateResult, DownloadUpdateResult, UpdateInfo, UpdateProgress } from './update.js'
import type { FsStatResult, ImportConfigResult, LocalTerminalStartPayload, LocalTerminalStartResult, LocalTerminalInputPayload, LocalTerminalResizePayload, RendererLogMessage } from './system.js'
import type { VaultInitResult, VaultPasswordResult, VaultRecoveryKeyResult, VaultRegenerateResult, VaultResetResult, VaultStatus, VaultUnlockResult } from './vault.js'
import type { SftpChmodRequest, SftpChmodResult, SftpDownloadFileRequest, SftpDownloadFileResult, SftpDownloadMultipleRequest, SftpDownloadMultipleResult, SftpDownloadForDragRequest, SftpDownloadForDragResultType, SftpStartDragRequest, SftpExtractRequest, SftpExtractResult, SftpMkdirRequest, SftpMkdirResult, SftpOpenInEditorRequest, SftpOpenInEditorResult, SftpOpenWithRequest, SftpOpenWithResult, SftpReaddirRequest, SftpReaddirResult, SftpRealpathRequest, SftpRealpathResult, SftpRenameRequest, SftpRenameResult, SftpRmRequest, SftpRmResult, SftpSelectFilesResult, SftpUploadDirectRequest, SftpUploadDirectResult, SftpUploadFilesFromPathsRequest, SftpUploadFilesFromPathsResult, SftpCancelUploadRequest, SftpCancelUploadResult } from './sftp.js'

declare global {
    interface Window {
        /** Снимок конфига, подставленный скриптом инициализации Tauri. */
        __YASSH_BOOTSTRAP__?: AppConfig | null
    }
}

type Unlisten = () => void

/** Подписывается на канал и отдаёт payload подписчику. */
function subscribe<T>(channel: string, callback: (payload: T) => void): Unlisten {
    let disposed = false
    let unlisten: Unlisten | undefined

    void listen(channel, (event: { payload: unknown }) => {
        callback(event.payload as T)
    }).then((stop: Unlisten) => {
        if (disposed) {
            stop()
            return
        }
        unlisten = stop
    })

    return () => {
        disposed = true
        unlisten?.()
    }
}

/** Подписка на канал с `id`: общий шаблон для SSH/SFTP/local-terminal. */
function subscribeById<T>(prefix: string, id: string, callback: (payload: T) => void): Unlisten {
    return subscribe<T>(`${prefix}-${id}`, callback)
}

/**
 * Канал сырого вывода для команды терминала.
 *
 * Рендерер создаёт `Channel<ArrayBuffer>` и передаёт его в `sshConnect` /
 * `localTerminalStart`: Rust отправляет байты напрямую, без base64 и
 * сериализации событий. Канал обязателен — другого пути доставки вывода нет.
 * Вне Tauri он не создаётся: команда всё равно не выполнится, а `new Channel`
 * упал бы на регистрации колбэка.
 */
function outputChannelFor(onData: (data: Uint8Array) => void): Channel<ArrayBuffer> | undefined {
    if (!('__TAURI_INTERNALS__' in window)) {
        console.warn('[ipc] Tauri IPC недоступен: канал вывода терминала не создан')
        return undefined
    }
    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (data) => onData(new Uint8Array(data))
    return channel
}

// ── drag&drop ────────────────────────────────────────────────────────────────

/** Подписчики `app-reload-request`: их может быть по одному на вкладку. */
const reloadRequestHandlers = new Set<() => void>()

/** Ошибки invoke при старте SFTP передаются тем же путём, что и ошибки SSH. */
const sftpConnectErrorHandlers = new Map<string, Set<(event: SftpErrorEvent) => void>>()

/** Навешивает DOM-обработчики для горячих клавиш renderer. */
function attachDomListeners(target: Window): void {
    target.addEventListener(
        'keydown',
        (event: KeyboardEvent) => {
            const isControlOrMeta = isMacPlatform() ? event.metaKey : event.ctrlKey
            if (isControlOrMeta && event.code === 'KeyR') {
                event.preventDefault()
                for (const handler of reloadRequestHandlers) {
                    handler()
                }
            } else if (event.key === 'F5') {
                event.preventDefault()
            }
        },
        true
    )

    // Меню webview по правому клику («Назад», «Обновить», «Сохранить как», «Печать»,
    // «Другие инструменты») в приложении бесполезно: это команды браузера, которых
    // в нём нет. Свои меню элементы показывают сами, уже вызвав `preventDefault()`
    // (сайдбар, список файлов, терминал), поэтому здесь гасится только штатное.
    target.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault()
    })
}

/** Передаёт native drag&drop события Tauri компонентам renderer. */
function watchDropPaths(target: Window): void {
    void listen<{ paths: string[]; icons: Array<string | null>; x: number; y: number }>('yash-drag-drop-preview', (event) => {
        target.dispatchEvent(new CustomEvent('yash-files-drag-preview', { detail: event.payload }))
    }).catch(() => {
        // Вне Tauri native file drop событий нет.
    })
    void listen<{ paths: string[]; icons: Array<string | null> }>('yash-drag-drop-icons', (event) => {
        target.dispatchEvent(new CustomEvent('yash-files-drag-icons', { detail: event.payload }))
    }).catch(() => {
        // Вне Tauri native file drop событий нет.
    })
    void listen<{ x: number; y: number }>('yash-drag-drop-position', (event) => {
        target.dispatchEvent(new CustomEvent('yash-files-drag-position', { detail: event.payload }))
    }).catch(() => {
        // Вне Tauri native file drop событий нет.
    })
    void listen<{ paths: string[]; icons: Array<string | null>; x: number; y: number }>('yash-drag-drop-paths', (event) => {
        target.dispatchEvent(new CustomEvent('yash-files-dropped', { detail: event.payload }))
    }).catch(() => {
        // Вне Tauri native file drop событий нет.
    })
    void listen<boolean>('yash-drag-drop-state', (event: { payload: boolean }) => {
        target.dispatchEvent(new CustomEvent('yash-files-drag-state', { detail: event.payload }))
    }).catch(() => {
        // Вне Tauri native file drop событий нет.
    })
}

// ── Платформа ────────────────────────────────────────────────────────────────

let cachedPlatform: string | undefined

/** Значение `process.platform` в терминах Node — его ожидает `IpcRendererApi`. */
function isMacPlatform(): boolean {
    if (cachedPlatform === undefined && typeof navigator !== 'undefined') {
        const agent = navigator.userAgent
        cachedPlatform = agent.includes('Mac') ? 'darwin' : agent.includes('Win') ? 'win32' : 'linux'
    }
    return cachedPlatform === 'darwin'
}

function platformId(): string {
    if (typeof navigator === 'undefined') {
        return 'linux'
    }
    const agent = navigator.userAgent
    return agent.includes('Mac') ? 'darwin' : agent.includes('Win') ? 'win32' : 'linux'
}

// ── Снимок конфига ───────────────────────────────────────────────────────────

function bootstrapConfig(): AppConfig {
    return window.__YASSH_BOOTSTRAP__ ?? ({} as AppConfig)
}

// ── API ──────────────────────────────────────────────────────────────────────

const api: IpcRendererApi = {
    // Путь файла в Tauri недоступен из DOM `File`: пути приходят отдельным
    // native-событием (`yash-drag-drop-paths`). Метод оставлен ради контракта.
    getPathForFile: () => '',

    // Settings & Config
    getConfigSync: () => bootstrapConfig(),
    getConfig: () => invoke<AppConfig>('get_config_async'),
    saveConfig: (config: AppConfig) => invoke<void>('save_config', { incoming: config }),
    rendererContentReady: () => {
        void invoke<void>('renderer_content_ready')
    },
    exportConfig: () => invoke<boolean>('export_config'),
    importConfig: () => invoke<ImportConfigResult | null>('import_config'),
    exportLogs: () => invoke<boolean>('export_logs'),
    logRendererMsg: (payload: RendererLogMessage) => {
        void invoke<void>('log_renderer_msg', { level: payload.level, message: payload.message })
    },

    // Телеметрия
    deleteTelemetry: () => invoke<number>('delete_telemetry'),

    // Vault
    vaultGetStatus: () => invoke<VaultStatus>('vault_get_status'),
    vaultInit: () => invoke<VaultInitResult>('vault_init'),
    vaultUnlock: (recoveryKey: string) => invoke<VaultUnlockResult>('vault_unlock', { recoveryKeyInput: recoveryKey }),
    vaultGetRecoveryKey: () => invoke<VaultRecoveryKeyResult>('vault_get_recovery_key'),
    vaultGetPassword: (serverId: string) => invoke<VaultPasswordResult>('vault_get_password', { serverId }),
    vaultGetKeyPassphrase: (serverId: string) => invoke<VaultPasswordResult>('vault_get_key_passphrase', { serverId }),
    vaultRegenerateKey: () => invoke<VaultRegenerateResult>('vault_regenerate_key'),
    vaultReset: () => invoke<VaultResetResult>('vault_reset'),
    /**
     * Сообщение о смене статуса хранилища после фонового переноса секретов в
     * системное хранилище.
     */
    onVaultStatusChanged: (callback: (status: VaultStatus) => void) =>
        listen<VaultStatus>('vault-status-changed', event => callback(event.payload)),

    // System/Dialogs
    selectKeyFile: () => invoke<string | null>('select_key_file'),
    loadPrivateKeyFile: () => invoke<string | null>('load_private_key_file'),
    readClipboardText: () => invoke<string>('read_clipboard_text'),
    writeClipboardText: (text: string) => invoke<void>('write_clipboard_text', { text }),
    encryptPrivateKey: (content: string) => invoke('encrypt_private_key', { content }),
    selectExecutableFile: () => invoke<string | null>('select_executable_file'),
    openExternal: (url: string) => {
        void invoke<void>('open_external', { url })
    },

    // Window Control
    minimize: () => {
        void invoke<void>('window_minimize')
    },
    maximize: () => {
        void invoke<void>('window_maximize')
    },
    isMaximized: () => invoke<boolean>('window_is_maximized'),
    close: () => {
        void invoke<void>('window_close')
    },
    flashFrame: () => {
        void invoke<void>('window_flash')
    },

    // SSH Actions
    sshConnect: (payload: SshConnectPayload, onOutput: (data: Uint8Array) => void) => {
        void invoke<void>('ssh_connect', { payload, onOutput: outputChannelFor(onOutput) })
    },
    sshAuthResponse: (payload: SshAuthResponse) => {
        void invoke<void>('ssh_auth_response', { payload })
    },
    sshInput: (payload: SshInputPayload) => {
        void invoke<void>('ssh_input', { payload })
    },
    sshResize: (payload: SshResizePayload) => {
        void invoke<void>('ssh_resize', { payload })
    },
    sshGetOSInfo: (id: string) => {
        void invoke<void>('ssh_get_os_info', { id })
    },
    sshClose: (id: string) => {
        void invoke<void>('ssh_close', { id })
    },
    sshClearFingerprint: (id: string) => invoke<void>('ssh_clear_fingerprint', { id }),
    sshFingerprintResponse: (payload: { id: string; accept: boolean }) => invoke<boolean>('ssh_fingerprint_response', { payload }),

    // SFTP Actions
    sftpConnect: (payload) => {
        void invoke<void>('sftp_connect', { payload }).catch((error: unknown) => {
            const handlers = sftpConnectErrorHandlers.get(payload.id)
            if (!handlers) return
            const event: SftpErrorEvent = {
                kind: 'ssh-error',
                message: error instanceof Error ? error.message : String(error)
            }
            handlers.forEach((handler) => handler(event))
        })
    },
    sftpReaddir: (payload: SftpReaddirRequest) => invoke<SftpReaddirResult>('sftp_readdir', { payload }),
    sftpRealpath: (payload: SftpRealpathRequest) => invoke<SftpRealpathResult>('sftp_realpath', { payload }),
    sftpMkdir: (payload: SftpMkdirRequest) => invoke<SftpMkdirResult>('sftp_mkdir', { payload }),
    sftpRm: (payload: SftpRmRequest) => invoke<SftpRmResult>('sftp_rm', { payload }),
    sftpRename: (payload: SftpRenameRequest) => invoke<SftpRenameResult>('sftp_rename', { payload }),
    sftpChmod: (payload: SftpChmodRequest) => invoke<SftpChmodResult>('sftp_chmod', { payload }),
    sftpExtract: (payload: SftpExtractRequest) => invoke<SftpExtractResult>('sftp_extract', { payload }),
    sftpDownloadFile: (payload: SftpDownloadFileRequest) => invoke<SftpDownloadFileResult>('sftp_download_file', { payload }),
    sftpDownloadMultiple: (payload: SftpDownloadMultipleRequest) => invoke<SftpDownloadMultipleResult>('sftp_download_multiple_files', { payload }),
    sftpDownloadForDrag: (payload: SftpDownloadForDragRequest) => invoke<SftpDownloadForDragResultType>('sftp_download_for_drag', { payload }),
    sftpPrepareDrag: (payload: SftpDownloadForDragRequest) => invoke<SftpDownloadForDragResultType>('sftp_prepare_drag', { payload }),
    sftpStartDrag: (payload: SftpStartDragRequest) => invoke<boolean>('sftp_drag_out', { payload }),
    sftpCleanupDragFiles: (tempDirectory: string) => invoke<boolean>('sftp_cleanup_drag_files', { tempDirectory }),
    sftpUploadFilesFromPaths: (payload: SftpUploadFilesFromPathsRequest) => invoke<SftpUploadFilesFromPathsResult>('sftp_upload_files_from_paths', { payload }),
    sftpUploadDirect: (payload: SftpUploadDirectRequest) => invoke<SftpUploadDirectResult>('sftp_upload_direct', { payload }),
    sftpCancelUpload: (payload: SftpCancelUploadRequest) => invoke<SftpCancelUploadResult>('sftp_cancel_upload', { payload }),
    sftpOpenInEditor: (payload: SftpOpenInEditorRequest) => invoke<SftpOpenInEditorResult>('sftp_open_in_editor', { payload }),
    sftpOpenWith: (payload: SftpOpenWithRequest) => invoke<SftpOpenWithResult>('sftp_open_with', { payload }),
    sftpSelectFiles: (mode: 'file' | 'folder') => invoke<SftpSelectFilesResult>('sftp_select_files', { mode }),

    // Local FS
    fsStat: (path: string) => invoke<FsStatResult | null>('fs_stat', { filePath: path }),

    // Local Terminal Actions
    localTerminalStart: (payload: LocalTerminalStartPayload, onOutput: (data: Uint8Array) => void) =>
        invoke<LocalTerminalStartResult>('local_terminal_start', { payload, onOutput: outputChannelFor(onOutput) }),
    localTerminalInput: (payload: LocalTerminalInputPayload) => {
        void invoke<void>('local_terminal_input', { payload })
    },
    localTerminalResize: (payload: LocalTerminalResizePayload) => {
        void invoke<void>('local_terminal_resize', { payload })
    },
    localTerminalClose: (id: string) => {
        void invoke<void>('local_terminal_close', { id })
    },

    // MCP Actions
    mcpGetStatus: () => invoke<McpStatus>('mcp_get_status'),
    mcpGetToken: () => invoke<string>('mcp_get_token'),
    mcpGetLogs: (connectionId: string) => invoke<McpLogItem[]>('mcp_get_logs', { connectionId }),
    mcpSetLogsVisible: (connectionId: string, isVisible: boolean) => {
        // `connectionId` указывает вкладку, но видимость журнала общая для
        // окна: MCP ведёт один буфер, и агент может работать с любой вкладки.
        void invoke<void>('mcp_set_logs_visible', { connectionId, isVisible })
    },
    mcpToggle: (enabled: boolean) => invoke<McpStatus>('mcp_toggle', { enabled }),
    mcpRegenerateToken: () => invoke<McpStatus>('mcp_regenerate_token'),
    mcpOpenServer: (serverId: string) => invoke<McpStatus>('mcp_open_server', { serverId }),
    mcpCloseServer: (serverId: string) => invoke<McpStatus>('mcp_close_server', { serverId }),
    mcpConfirmCommand: (payload: McpConfirmCommandPayload) => invoke<boolean>('mcp_confirm_command', { payload }),
    mcpCancelRun: (runId: string) => invoke<boolean>('mcp_cancel_run', { runId }),

    // Port Forwarding
    sshForwardStart: (payload: SshForwardStartPayload) => invoke<boolean>('ssh_forward_start', { payload }),
    sshForwardStop: (id: string) => invoke<boolean>('ssh_forward_stop', { id }),

    // Updates
    checkUpdates: (allowPreRelease: boolean) => invoke<CheckUpdateResult>('check_updates', { allowPreRelease }),
    startUpdateDownload: () => invoke<DownloadUpdateResult>('start_update_download'),
    installUpdate: () => invoke<void>('install_update'),

    // Events
    onLocalTerminalExit: (id, callback) => subscribeById<number>('local-terminal-exit', id, (value) => callback(value)),
    onSSHStatus: (id, callback) => subscribeById<string>('ssh-status', id, (value) => callback(value)),
    onSSHAuthChallenge: (id, callback) => subscribeById<SshAuthChallenge>('ssh-auth-challenge', id, (value) => callback(value)),
    onSSHFingerprint: (callback) => subscribe<SshFingerprintChallenge>('ssh-fingerprint', callback),
    onSSHFingerprintSaved: (callback) => subscribe<{ id: string; fingerprint: string }>('ssh-fingerprint-saved', callback),
    onSSHError: (id, callback) => subscribeById<string>('ssh-error', id, (value) => callback(value)),
    onSSHOSInfo: (id, callback) => subscribeById<string>('ssh-os-info', id, (value) => callback(value)),
    onSFTPStatus: (id, callback) => subscribeById<SftpStatusEvent>('sftp-status', id, (value) => callback(value)),
    onSFTPError: (id, callback) => {
        const unlisten = subscribeById<SftpErrorEvent>('sftp-error', id, callback)
        const handlers = sftpConnectErrorHandlers.get(id) ?? new Set<(event: SftpErrorEvent) => void>()
        handlers.add(callback)
        sftpConnectErrorHandlers.set(id, handlers)
        return () => {
            unlisten()
            handlers.delete(callback)
            if (handlers.size === 0) sftpConnectErrorHandlers.delete(id)
        }
    },
    onSFTPFileChanged: (id, callback) => subscribeById<SftpFileChangedEvent>('sftp-file-changed', id, (value) => callback(value)),
    onSFTPProgress: (id, callback) => subscribeById<SftpProgress>('sftp-progress', id, (value) => callback(value)),
    onSFTPStart: (id, callback) => subscribeById<SftpTransferStartEvent>('sftp-transfer-start', id, (value) => callback(value)),
    onUpdateStatus: (callback) => subscribe<UpdateStatus>('update-status', (value) => callback(value)),
    onUpdateAvailable: (callback) => subscribe<UpdateInfo>('update-available', (value) => callback(value)),
    onUpdateProgress: (callback) => subscribe<UpdateProgress>('update-progress', (value) => callback(value)),
    onUpdateError: (callback) => subscribe<string>('update-error', (value) => callback(value)),
    onMcpStatusChanged: (callback) => subscribe<McpStatus>('mcp-status-changed', (value) => callback(value)),
    onMcpLog: (callback) => subscribe<McpLogItem>('mcp-log', (value) => callback(value)),
    onMcpRequestConfirmation: (callback) => subscribe<McpConfirmationRequest>('mcp-request-confirmation', (value) => callback(value)),
    onAppReloadRequest: (callback: () => void) => {
        reloadRequestHandlers.add(callback)
        return () => {
            reloadRequestHandlers.delete(callback)
        }
    },
    onWindowMaximizedState: (callback) =>
        subscribe<{ isMaximized: boolean }>('window-maximized-state', (value) => callback(value.isMaximized)),
    onWindowCaptionHover: (callback) =>
        subscribe<boolean>('window-caption-hover', (value) => callback(value === true)),
    onWindowCloseHover: (callback) =>
        subscribe<boolean>('window-close-hover', (value) => callback(value === true)),
    onWindowMinimizeHover: (callback) =>
        subscribe<boolean>('window-minimize-hover', (value) => callback(value === true)),

    platform: platformId()
}

/**
 * Устанавливает `window.ipcRenderer` для Tauri-рантайма.
 *
 * Вне Tauri (сборка renderer отдельно, обычная страница в браузере) объект не
 * устанавливается: так импорт модуля не падает и не выполняет IPC-вызовы при
 * загрузке.
 */
export function installIpcBridge(target: Window = window): IpcRendererApi {
    // Фильтр ставится до установки моста и независимо от него: предупреждение
    // приходит из JS-контракта Tauri и не связано с `installIpcBridge`.
    installLostCallbackFilter(console)

    if ('__TAURI_INTERNALS__' in target) {
        target.ipcRenderer = api
        attachDomListeners(target)
        watchDropPaths(target)
    }
    return api
}

export type { Unlisten }
