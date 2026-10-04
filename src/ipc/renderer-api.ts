import type {
    AppConfig,
    EncryptedSecret,
    LocalTerminalStartPayload,
    LocalTerminalStartResult,
    SftpErrorEvent,
    SftpProgress,
    SftpStatusEvent,
    UpdateStatus
} from '../types.js'
import type { SshAuthChallenge, SshAuthResponse, SshConnectPayload, SshFingerprintChallenge, SshForwardStartPayload, SshInputPayload, SshResizePayload } from './ssh.js'
import type {
    SftpCancelUploadRequest,
    SftpCancelUploadResult,
    SftpChmodRequest,
    SftpChmodResult,
    SftpConnectPayload,
    SftpDownloadFileRequest,
    SftpDownloadFileResult,
    SftpDownloadMultipleRequest,
    SftpDownloadMultipleResult,
    SftpExtractRequest,
    SftpExtractResult,
    SftpFileChangedEvent,
    SftpMkdirRequest,
    SftpMkdirResult,
    SftpOpenInEditorRequest,
    SftpOpenInEditorResult,
    SftpOpenWithRequest,
    SftpOpenWithResult,
    SftpReaddirRequest,
    SftpReaddirResult,
    SftpRealpathRequest,
    SftpRealpathResult,
    SftpRenameRequest,
    SftpRenameResult,
    SftpRmRequest,
    SftpRmResult,
    SftpSelectFilesResult,
    SftpTransferStartEvent,
    SftpUploadDirectRequest,
    SftpUploadDirectResult,
    SftpUploadFilesFromPathsRequest,
    SftpUploadFilesFromPathsResult
} from './sftp.js'
import type { McpConfirmCommandPayload, McpConfirmationRequest, McpLogItem, McpStatus } from './mcp.js'
import type { CheckUpdateResult, DownloadUpdateResult, UpdateInfo, UpdateProgress } from './update.js'
import type {
    FsStatResult,
    ImportConfigResult,
    LocalTerminalInputPayload,
    LocalTerminalResizePayload,
    RendererLogMessage
} from './system.js'
import type {
    VaultInitResult,
    VaultPasswordResult,
    VaultRecoveryKeyResult,
    VaultRegenerateResult,
    VaultResetResult,
    VaultStatus,
    VaultUnlockResult
} from './vault.js'

/** API, доступное в рендерере как `window.ipcRenderer`. */
export interface IpcRendererApi {
    getPathForFile: (file: File) => string;

    // Settings & Config
    getConfigSync: () => AppConfig;
    getConfig: () => Promise<AppConfig>;
    saveConfig: (config: AppConfig) => Promise<void>;
    rendererContentReady: () => void;
    exportConfig: () => Promise<boolean>;
    importConfig: () => Promise<ImportConfigResult | null>;
    exportLogs: () => Promise<boolean>;
    logRendererMsg: (payload: RendererLogMessage) => void;

    // Vault
    vaultGetStatus: () => Promise<VaultStatus>;
    vaultInit: () => Promise<VaultInitResult>;
    vaultUnlock: (recoveryKey: string) => Promise<VaultUnlockResult>;
    vaultGetRecoveryKey: () => Promise<VaultRecoveryKeyResult>;
    vaultGetPassword: (serverId: string) => Promise<VaultPasswordResult>;
    vaultGetKeyPassphrase: (serverId: string) => Promise<VaultPasswordResult>;
    vaultRegenerateKey: () => Promise<VaultRegenerateResult>;
    vaultReset: () => Promise<VaultResetResult>;
    onVaultStatusChanged: (callback: (status: VaultStatus) => void) => Promise<() => void>;

    // System/Dialogs
    selectKeyFile: () => Promise<string | null>;
    loadPrivateKeyFile: () => Promise<string | null>;
    readClipboardText: () => Promise<string>;
    writeClipboardText: (text: string) => Promise<void>;
    encryptPrivateKey: (content: string) => Promise<EncryptedSecret>;
    selectExecutableFile: () => Promise<string | null>;
    openExternal: (url: string) => void;

    // Window Control
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    flashFrame: () => void;
    /** Текущее состояние «развёрнуто»: иконка кнопки на старте рендерера. */
    isMaximized: () => Promise<boolean>;

    // SSH Actions
    sshConnect: (payload: SshConnectPayload) => void;
    sshAuthResponse: (payload: SshAuthResponse) => void;
    sshInput: (payload: SshInputPayload) => void;
    sshResize: (payload: SshResizePayload) => void;
    sshGetOSInfo: (id: string) => void;
    sshClose: (id: string) => void;
    /**
     * Удаляет сохранённый отпечаток ключа хоста: следующее подключение снова
     * спросит его. Отдельная команда, потому что отпечаток принадлежит
     * main-процессу и не приходит из снимка конфига.
     */
    sshClearFingerprint: (id: string) => Promise<void>;
    /**
     * Решение по отпечатку ключа хоста: `true` сохраняет отпечаток и продолжает
     * подключение, `false` отменяет его. Отдельная команда, потому что отпечаток
     * спрашивают терминал, SFTP и проброс портов, а не только реестр авторизации.
     */
    sshFingerprintResponse: (payload: { id: string; accept: boolean }) => Promise<boolean>;

    // SFTP Actions
    sftpConnect: (payload: SftpConnectPayload) => void;
    sftpReaddir: (payload: SftpReaddirRequest) => Promise<SftpReaddirResult>;
    sftpRealpath: (payload: SftpRealpathRequest) => Promise<SftpRealpathResult>;
    sftpMkdir: (payload: SftpMkdirRequest) => Promise<SftpMkdirResult>;
    sftpRm: (payload: SftpRmRequest) => Promise<SftpRmResult>;
    sftpRename: (payload: SftpRenameRequest) => Promise<SftpRenameResult>;
    sftpChmod: (payload: SftpChmodRequest) => Promise<SftpChmodResult>;
    sftpExtract: (payload: SftpExtractRequest) => Promise<SftpExtractResult>;
    sftpDownloadFile: (payload: SftpDownloadFileRequest) => Promise<SftpDownloadFileResult>;
    sftpDownloadMultiple: (payload: SftpDownloadMultipleRequest) => Promise<SftpDownloadMultipleResult>;
    sftpUploadFilesFromPaths: (payload: SftpUploadFilesFromPathsRequest) => Promise<SftpUploadFilesFromPathsResult>;
    sftpUploadDirect: (payload: SftpUploadDirectRequest) => Promise<SftpUploadDirectResult>;
    sftpCancelUpload: (payload: SftpCancelUploadRequest) => Promise<SftpCancelUploadResult>;
    sftpOpenInEditor: (payload: SftpOpenInEditorRequest) => Promise<SftpOpenInEditorResult>;
    sftpOpenWith: (payload: SftpOpenWithRequest) => Promise<SftpOpenWithResult>;
    sftpSelectFiles: (mode: 'file' | 'folder') => Promise<SftpSelectFilesResult>;

    // Local FS
    fsStat: (path: string) => Promise<FsStatResult | null>;

    // Local Terminal Actions
    localTerminalStart: (payload: LocalTerminalStartPayload) => Promise<LocalTerminalStartResult>;
    localTerminalInput: (payload: LocalTerminalInputPayload) => void;
    localTerminalResize: (payload: LocalTerminalResizePayload) => void;
    localTerminalClose: (id: string) => void;

    // MCP Actions
    mcpGetStatus: () => Promise<McpStatus>;
    mcpGetToken: () => Promise<string>;
    mcpGetLogs: (connectionId: string) => Promise<McpLogItem[]>;
    mcpSetLogsVisible: (connectionId: string, isVisible: boolean) => void;
    mcpToggle: (enabled: boolean) => Promise<McpStatus>;
    mcpRegenerateToken: () => Promise<McpStatus>;
    mcpOpenServer: (serverId: string) => Promise<McpStatus>;
    mcpCloseServer: (serverId: string) => Promise<McpStatus>;
    mcpConfirmCommand: (payload: McpConfirmCommandPayload) => Promise<boolean>;
    mcpCancelRun: (runId: string) => Promise<boolean>;
    onMcpStatusChanged: (callback: (status: McpStatus) => void) => () => void;
    onMcpLog: (callback: (log: McpLogItem) => void) => () => void;
    onMcpRequestConfirmation: (callback: (req: McpConfirmationRequest) => void) => () => void;

    // Port Forwarding
    sshForwardStart: (payload: SshForwardStartPayload) => Promise<boolean>;
    sshForwardStop: (id: string) => Promise<boolean>;

    // Updates
    /** `allowPreRelease` — дополнительно принимать pre-release сборки. */
    checkUpdates: (allowPreRelease: boolean) => Promise<CheckUpdateResult>;
    /** Скачать найденное обновление. Установка — отдельным действием. */
    startUpdateDownload: () => Promise<DownloadUpdateResult>;
    /** Установить скачанное обновление и перезапустить приложение. */
    installUpdate: () => Promise<void>;

    // Events
    onSSHOutput: (id: string, callback: (data: Uint8Array) => void) => () => void;
    onLocalTerminalOutput: (id: string, callback: (data: string) => void) => () => void;
    onLocalTerminalExit: (id: string, callback: (exitCode: number) => void) => () => void;
    onSSHStatus: (id: string, callback: (status: string) => void) => () => void;
    onSSHAuthChallenge: (id: string, callback: (challenge: SshAuthChallenge) => void) => () => void;
    onSSHFingerprint: (callback: (challenge: SshFingerprintChallenge) => void) => () => void;
    /**
     * Отпечаток подтверждён и сохранён main-процессом. Событие нужно, чтобы
     * снимок избранного в webview не остался устаревшим: иначе редактор сервера
     * продолжил бы показывать, что ключ не подтверждён.
     */
    onSSHFingerprintSaved: (callback: (payload: { id: string; fingerprint: string }) => void) => () => void;
    onSSHError: (id: string, callback: (error: string) => void) => () => void;
    onSSHOSInfo: (id: string, callback: (info: string) => void) => () => void;
    onSFTPStatus: (id: string, callback: (status: SftpStatusEvent) => void) => () => void;
    onSFTPError: (id: string, callback: (error: SftpErrorEvent) => void) => () => void;
    onSFTPFileChanged: (id: string, callback: (data: SftpFileChangedEvent) => void) => () => void;
    onSFTPProgress: (id: string, callback: (progress: SftpProgress) => void) => () => void;
    onSFTPStart: (id: string, callback: (data: SftpTransferStartEvent) => void) => () => void;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
    onUpdateError: (callback: (error: string) => void) => () => void;
    onAppReloadRequest: (callback: () => void) => () => void;
    onWindowMaximizedState?: (callback: (isMaximized: boolean) => void) => () => void;
    /**
     * Курсор над кнопкой развёртывания.
     *
     * На Windows поверх этой кнопки лежит прозрачный оверлей для нативного
     * меню привязки (см. `src-tauri/src/window/snap.rs`), поэтому мышь до
     * кнопки не доходит и наведение приходит из Rust.
     */
    onWindowCaptionHover?: (callback: (hovering: boolean) => void) => () => void;
    /** Нажата кнопка развёртывания — тот же оверлей перехватывает и клик. */
    onWindowCaptionClick?: (callback: () => void) => () => void;

    platform: string;
}
