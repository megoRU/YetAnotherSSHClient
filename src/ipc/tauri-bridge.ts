/**
 * Мост между renderer и Tauri.
 *
 * Реализует ровно тот интерфейс `IpcRendererApi`, который раньше предоставлял
 * `contextBridge` в `electron/preload.ts`, поэтому React-код не меняется:
 * компоненты продолжают обращаться к `window.ipcRenderer`.
 *
 * Что здесь неочевидно и почему так сделано:
 *
 * 1. `getConfigSync()` обязан быть синхронным — `useConfig` читает конфиг до
 *    первого `await`. Снимок конфига подставляется в webview скриптом
 *    инициализации (`window.__YASSH_BOOTSTRAP__`), который выполняется до
 *    загрузки приложения. Так же поступил бы и Electron: там синхронный
 *    `ipcRenderer.sendSync` блокировал бы поток рендерера.
 * 2. События приходят через `listen` с теми же именами каналов, что и в
 *    Electron (`ssh-output-${id}`, `mcp-log`, …), поэтому подписчики в
 *    компонентах не меняются.
 * 3. `ssh-output` и `local-terminal-output` передаются в base64: JSON-массив
 *    чисел на каждом чанке вывода заметно дороже по IPC.
 * 4. `Ctrl+R`/`F5` перехватываются в DOM (capture-фаза), а не в main-процессе:
 *    в Tauri нет аналога `before-input-event`, а `preventDefault` в webview
 *    надёжно отменяет перезагрузку. Событие `app-reload-request` уходит в
 *    компоненты тем же способом, что и раньше.
 * 5. `getPathForFile` в Tauri отсутствует: пути приходят событием
 *    `yash-drag-drop-paths`. Мост сопоставляет их с объектами `DataTransfer`
 *    по индексу (порядок совпадает с порядком файлов в drop), а при несовпадении
 *    количества отдаёт пустой путь — лучше явная ошибка, чем загрузка не того
 *    файла.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { IpcRendererApi } from './index.js'
import type { AppConfig, SftpErrorEvent, SftpStatusEvent, UpdateStatus } from '../types.js'
import type { SshAuthChallenge, SshAuthResponse, SshInputPayload, SshResizePayload, SshConnectPayload, SshForwardStartPayload } from './ssh.js'
import type { SftpTransferStartEvent, SftpFileChangedEvent, SftpProgress } from './sftp.js'
import type { McpConfirmCommandPayload, McpConfirmationRequest, McpLogItem, McpStatus } from './mcp.js'
import type { CheckUpdateResult, DownloadUpdateResult, UpdateInfo, UpdateProgress } from './update.js'
import type { FsStatResult, ImportConfigResult, LocalTerminalStartPayload, LocalTerminalStartResult, LocalTerminalInputPayload, LocalTerminalResizePayload, RendererLogMessage } from './system.js'
import type { VaultInitResult, VaultPasswordResult, VaultRecoveryKeyResult, VaultRegenerateResult, VaultResetResult, VaultStatus, VaultUnlockResult } from './vault.js'
import type { SftpChmodRequest, SftpChmodResult, SftpDownloadFileRequest, SftpDownloadFileResult, SftpDownloadMultipleRequest, SftpDownloadMultipleResult, SftpExtractRequest, SftpExtractResult, SftpMkdirRequest, SftpMkdirResult, SftpOpenInEditorRequest, SftpOpenInEditorResult, SftpOpenWithRequest, SftpOpenWithResult, SftpReaddirRequest, SftpReaddirResult, SftpRealpathRequest, SftpRealpathResult, SftpRenameRequest, SftpRenameResult, SftpRmRequest, SftpRmResult, SftpSelectFilesResult, SftpUploadDirectRequest, SftpUploadDirectResult, SftpUploadFilesFromPathsRequest, SftpUploadFilesFromPathsResult, SftpCancelUploadRequest, SftpCancelUploadResult } from './sftp.js'

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

/** Декодирует base64 в `Uint8Array`. */
function decodeBase64(value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

// ── drag&drop ────────────────────────────────────────────────────────────────

/** Пути последнего drop-события (их присылает Rust). */
let lastDropPaths: string[] = []

/** Файлы текущего drop-события: Chromium не отдаёт `DataTransfer` наружу. */
let currentFiles: File[] = []

/** Подписчики `app-reload-request`: их может быть по одному на вкладку. */
const reloadRequestHandlers = new Set<() => void>()

/**
 * Сопоставляет объект `DataTransfer.files` с путями от Tauri.
 *
 * Порядок файлов в `DataTransfer` совпадает с порядком, в котором ОС сообщила
 * пути, поэтому сопоставление по индексу корректно.
 */
function resolveDroppedPath(file: File): string {
    if (currentFiles.length === 0 || currentFiles.length !== lastDropPaths.length) {
        return ''
    }
    const index = currentFiles.indexOf(file)
    if (index < 0) {
        return ''
    }
    return lastDropPaths[index] ?? ''
}

/** Навешивает DOM-обработчики: drag&drop и перехват Ctrl+R/F5. */
function attachDomListeners(target: Window): void {
    target.addEventListener(
        'drop',
        (event: DragEvent) => {
            currentFiles = event.dataTransfer ? Array.from(event.dataTransfer.files) : []
        },
        true
    )

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
}

/** Подписка на пути drag&drop. */
function watchDropPaths(): void {
    void listen<string[]>('yash-drag-drop-paths', (event: { payload: string[] }) => {
        lastDropPaths = event.payload
    }).catch(() => {
        // События может не быть: перетаскивание продолжит работать через
        // пустую строку пути, компонент покажет понятное сообщение.
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
    getPathForFile: (file: File) => resolveDroppedPath(file),

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

    // Vault
    vaultGetStatus: () => invoke<VaultStatus>('vault_get_status'),
    vaultInit: () => invoke<VaultInitResult>('vault_init'),
    vaultUnlock: (recoveryKey: string) => invoke<VaultUnlockResult>('vault_unlock', { recoveryKeyInput: recoveryKey }),
    vaultGetRecoveryKey: () => invoke<VaultRecoveryKeyResult>('vault_get_recovery_key'),
    vaultGetPassword: (serverId: string) => invoke<VaultPasswordResult>('vault_get_password', { serverId }),
    vaultRegenerateKey: () => invoke<VaultRegenerateResult>('vault_regenerate_key'),
    vaultReset: () => invoke<VaultResetResult>('vault_reset'),

    // System/Dialogs
    selectKeyFile: () => invoke<string | null>('select_key_file'),
    loadPrivateKeyFile: () => invoke<string | null>('load_private_key_file'),
    readClipboardText: () => invoke<string>('read_clipboard_text'),
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
    close: () => {
        void invoke<void>('window_close')
    },
    flashFrame: () => {
        void invoke<void>('window_flash')
    },

    // SSH Actions
    sshConnect: (payload: SshConnectPayload) => {
        void invoke<void>('ssh_connect', { payload })
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

    // SFTP Actions
    sftpConnect: (payload) => {
        void invoke<void>('sftp_connect', { payload })
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
    sftpUploadFilesFromPaths: (payload: SftpUploadFilesFromPathsRequest) => invoke<SftpUploadFilesFromPathsResult>('sftp_upload_files_from_paths', { payload }),
    sftpUploadDirect: (payload: SftpUploadDirectRequest) => invoke<SftpUploadDirectResult>('sftp_upload_direct', { payload }),
    sftpCancelUpload: (payload: SftpCancelUploadRequest) => invoke<SftpCancelUploadResult>('sftp_cancel_upload', { payload }),
    sftpOpenInEditor: (payload: SftpOpenInEditorRequest) => invoke<SftpOpenInEditorResult>('sftp_open_in_editor', { payload }),
    sftpOpenWith: (payload: SftpOpenWithRequest) => invoke<SftpOpenWithResult>('sftp_open_with', { payload }),
    sftpSelectFiles: (mode: 'file' | 'folder') => invoke<SftpSelectFilesResult>('sftp_select_files', { mode }),

    // Local FS
    fsStat: (path: string) => invoke<FsStatResult | null>('fs_stat', { filePath: path }),

    // Local Terminal Actions
    localTerminalStart: (payload: LocalTerminalStartPayload) => invoke<LocalTerminalStartResult>('local_terminal_start', { payload }),
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
    checkUpdates: () => invoke<CheckUpdateResult>('check_updates'),
    startUpdateDownload: () => invoke<DownloadUpdateResult>('start_update_download'),
    quitAndInstall: () => {
        void invoke<void>('quit_and_install')
    },

    // Events
    onSSHOutput: (id, callback) => subscribeById<string>('ssh-output', id, (value) => callback(decodeBase64(value))),
    onLocalTerminalOutput: (id, callback) => subscribeById<string>('local-terminal-output', id, (value) => callback(value)),
    onLocalTerminalExit: (id, callback) => subscribeById<number>('local-terminal-exit', id, (value) => callback(value)),
    onSSHStatus: (id, callback) => subscribeById<string>('ssh-status', id, (value) => callback(value)),
    onSSHAuthChallenge: (id, callback) => subscribeById<SshAuthChallenge>('ssh-auth-challenge', id, (value) => callback(value)),
    onSSHError: (id, callback) => subscribeById<string>('ssh-error', id, (value) => callback(value)),
    onSSHOSInfo: (id, callback) => subscribeById<string>('ssh-os-info', id, (value) => callback(value)),
    onSFTPStatus: (id, callback) => subscribeById<SftpStatusEvent>('sftp-status', id, (value) => callback(value)),
    onSFTPError: (id, callback) => subscribeById<SftpErrorEvent>('sftp-error', id, (value) => callback(value)),
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

    platform: platformId()
}

/**
 * Устанавливает `window.ipcRenderer` для Tauri-рантайма.
 *
 * Вне Tauri (vitest, сборка renderer отдельно) объект не устанавливается:
 * тесты подставляют собственный мок. Так импорт модуля не падает и не
 * выполняет IPC-вызовы при загрузке.
 */
export function installIpcBridge(target: Window = window): IpcRendererApi {
    if ('__TAURI_INTERNALS__' in target) {
        target.ipcRenderer = api
        attachDomListeners(target)
        watchDropPaths()
    }
    return api
}

export type { Unlisten }
