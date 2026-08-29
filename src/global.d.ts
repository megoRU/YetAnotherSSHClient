export interface IpcRendererApi {
  getPathForFile: (file: File) => string;

  // Settings & Config
  getConfigSync: () => unknown;
  getConfig: () => Promise<unknown>;
  saveConfig: (config: unknown) => Promise<void>;
  rendererContentReady: () => void;
  exportConfig: () => Promise<boolean>;
  importConfig: () => Promise<unknown | null>;

  // Vault
  vaultGetStatus: () => Promise<{ isUnlocked: boolean, isInitialized: boolean }>;
  vaultInit: () => Promise<string | null>;
  vaultUnlock: (recoveryKey: string) => Promise<boolean>;
  vaultGetRecoveryKey: () => Promise<string | null>;
  vaultGetPassword: (serverId: string) => Promise<string | null>;
  vaultRegenerateKey: () => Promise<{ recoveryKey: string; config: unknown } | null>;
  vaultReset: () => Promise<{ recoveryKey: string; config: unknown } | null>;

  // System/Dialogs
  selectKeyFile: () => Promise<string | null>;
  selectExecutableFile: () => Promise<string | null>;
  openExternal: (url: string) => void;

  // Window Control
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  flashFrame: () => void;

  // SSH Actions
  sshConnect: (payload: unknown) => void;
  sshInput: (payload: unknown) => void;
  sshResize: (payload: unknown) => void;
  sshGetOSInfo: (id: string) => void;
  sshClose: (id: string) => void;

  // SFTP Actions
  sftpConnect: (payload: unknown) => void;
  sftpReaddir: (payload: unknown) => Promise<unknown>;
  sftpRealpath: (payload: unknown) => Promise<string>;
  sftpMkdir: (payload: unknown) => Promise<boolean | null>;
  sftpRm: (payload: unknown) => Promise<boolean | null>;
  sftpRename: (payload: unknown) => Promise<boolean | null>;
  sftpChmod: (payload: unknown) => Promise<boolean | null>;
  sftpExtract: (payload: unknown) => Promise<boolean>;
  sftpDownloadFile: (payload: unknown) => Promise<unknown>;
  sftpDownloadMultiple: (payload: unknown) => Promise<unknown>;
  sftpUploadFilesFromPaths: (payload: unknown) => Promise<unknown>;
  sftpUploadDirect: (payload: unknown) => Promise<boolean>;
  sftpCancelUpload: (payload: unknown) => Promise<boolean>;
  sftpOpenInEditor: (payload: unknown) => Promise<boolean | null>;
  sftpOpenWith: (payload: unknown) => Promise<boolean | null>;
  sftpSelectFiles: (mode: 'file' | 'folder') => Promise<unknown>;

  // Local FS
  fsStat: (path: string) => Promise<unknown>;

  // MCP Actions
  mcpGetStatus: () => Promise<{ enabled: boolean; running: boolean; port: number; connectedAgents: number; token: string; requireConfirmation: boolean; allowedServerIds: string[]; pendingConfirmations?: Array<{ id: string; connectionId: string; serverName: string; command: string }> }>;
  mcpToggle: (enabled: boolean) => Promise<unknown>;
  mcpRegenerateToken: () => Promise<unknown>;
  mcpOpenServer: (serverId: string) => Promise<McpStatus>;
  mcpCloseServer: (serverId: string) => Promise<unknown>;
  mcpConfirmCommand: (payload: { id: string; approved: boolean }) => Promise<boolean>;
  onMcpStatusChanged: (callback: (status: McpStatus) => void) => () => void;
  onMcpLog: (callback: (log: McpLogItem) => void) => () => void;
  onMcpRequestConfirmation: (callback: (req: McpConfirmationRequest) => void) => () => void;

  // Port Forwarding
  sshForwardStart: (payload: unknown) => Promise<boolean>;
  sshForwardStop: (id: string) => Promise<boolean>;

  // Updates
  checkUpdates: () => Promise<unknown>;
  startUpdateDownload: () => Promise<unknown>;
  quitAndInstall: () => void;

  // Events
  onSSHOutput: (id: string, callback: (data: Uint8Array) => void) => () => void;
  onSSHStatus: (id: string, callback: (status: string) => void) => () => void;
  onSSHError: (id: string, callback: (error: string) => void) => () => void;
  onSSHOSInfo: (id: string, callback: (info: string) => void) => () => void;
  onSFTPStatus: (id: string, callback: (status: string) => void) => () => void;
  onSFTPError: (id: string, callback: (error: string) => void) => () => void;
  onSFTPFileChanged: (id: string, callback: (data: unknown) => void) => () => void;
  onSFTPProgress: (id: string, callback: (progress: unknown) => void) => () => void;
  onSFTPStart: (id: string, callback: (data: unknown) => void) => () => void;
  onUpdateStatus: (callback: (status: string) => void) => () => void;
  onUpdateAvailable: (callback: (info: unknown) => void) => () => void;
  onUpdateProgress: (callback: (progress: unknown) => void) => () => void;
  onUpdateError: (callback: (error: string) => void) => () => void;
  onAppReloadRequest: (callback: () => void) => () => void;

  platform: string;
}

declare global {
  interface Window {
    ipcRenderer: IpcRendererApi;
  }
}
