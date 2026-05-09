import {contextBridge, ipcRenderer, webUtils} from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Settings & Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('save-config', config),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),

  // Vault
  vaultGetStatus: () => ipcRenderer.invoke('vault-get-status'),
  vaultInit: () => ipcRenderer.invoke('vault-init'),
  vaultUnlock: (recoveryKey: string) => ipcRenderer.invoke('vault-unlock', recoveryKey),
  vaultGetRecoveryKey: () => ipcRenderer.invoke('vault-get-recovery-key'),
  vaultGetPassword: (serverId: string) => ipcRenderer.invoke('vault-get-password', serverId),
  vaultRegenerateKey: () => ipcRenderer.invoke('vault-regenerate-key'),
  vaultReset: () => ipcRenderer.invoke('vault-reset'),

  // System/Dialogs
  selectKeyFile: () => ipcRenderer.invoke('select-key-file'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),

  // Window Control
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  flashFrame: () => ipcRenderer.send('window-flash'),

  // SSH Actions
  sshConnect: (payload: unknown) => ipcRenderer.send('ssh-connect', payload),
  sshInput: (payload: unknown) => ipcRenderer.send('ssh-input', payload),
  sshResize: (payload: unknown) => ipcRenderer.send('ssh-resize', payload),
  sshGetOSInfo: (id: string) => ipcRenderer.send('ssh-get-os-info', id),
  sshClose: (id: string) => ipcRenderer.send('ssh-close', id),

  // SFTP Actions
  sftpConnect: (payload: unknown) => ipcRenderer.send('sftp-connect', payload),
  sftpReaddir: (payload: unknown) => ipcRenderer.invoke('sftp-readdir', payload),
  sftpStat: (payload: unknown) => ipcRenderer.invoke('sftp-stat', payload),
  sftpRealpath: (payload: unknown) => ipcRenderer.invoke('sftp-realpath', payload),
  sftpMkdir: (payload: unknown) => ipcRenderer.invoke('sftp-mkdir', payload),
  sftpRm: (payload: unknown) => ipcRenderer.invoke('sftp-rm', payload),
  sftpRename: (payload: unknown) => ipcRenderer.invoke('sftp-rename', payload),
  sftpChmod: (payload: unknown) => ipcRenderer.invoke('sftp-chmod', payload),
  sftpExtract: (payload: unknown) => ipcRenderer.invoke('sftp-extract', payload),
  sftpDownloadFile: (payload: unknown) => ipcRenderer.invoke('sftp-download-file', payload),
  sftpDownloadMultiple: (payload: unknown) => ipcRenderer.invoke('sftp-download-multiple-files', payload),
  sftpUploadFile: (payload: unknown) => ipcRenderer.invoke('sftp-upload-file', payload),
  sftpUploadFilesFromPaths: (payload: unknown) => ipcRenderer.invoke('sftp-upload-files-from-paths', payload),
  sftpUploadDirect: (payload: unknown) => ipcRenderer.invoke('sftp-upload-direct', payload),
  sftpCancelUpload: (payload: unknown) => ipcRenderer.invoke('sftp-cancel-upload', payload),
  sftpOpenInEditor: (payload: unknown) => ipcRenderer.invoke('sftp-open-in-editor', payload),
  sftpSelectFiles: (mode: 'file' | 'folder') => ipcRenderer.invoke('sftp-select-files', mode),

  // Local FS
  fsStat: (path: string) => ipcRenderer.invoke('fs-stat', path),

  // Port Forwarding
  sshForwardStart: (payload: unknown) => ipcRenderer.invoke('ssh-forward-start', payload),
  sshForwardStop: (id: string) => ipcRenderer.invoke('ssh-forward-stop', id),
  openPortForwardingWindow: (config: unknown) => ipcRenderer.send('open-port-forwarding-window', config),

  // Updates
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),

  // Events
  onSSHOutput: (id: string, callback: (data: Uint8Array) => void) => {
    const channel = `ssh-output-${id}`
    const sub = (_: unknown, data: Uint8Array) => callback(data)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSSHStatus: (id: string, callback: (status: string) => void) => {
    const channel = `ssh-status-${id}`
    const sub = (_: unknown, status: string) => callback(status)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSSHError: (id: string, callback: (error: string) => void) => {
    const channel = `ssh-error-${id}`
    const sub = (_: unknown, error: string) => callback(error)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSSHOSInfo: (id: string, callback: (info: string) => void) => {
    const channel = `ssh-os-info-${id}`
    const sub = (_: unknown, info: string) => callback(info)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSFTPStatus: (id: string, callback: (status: string) => void) => {
    const channel = `sftp-status-${id}`
    const sub = (_: unknown, status: string) => callback(status)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSFTPError: (id: string, callback: (error: string) => void) => {
    const channel = `sftp-error-${id}`
    const sub = (_: unknown, error: string) => callback(error)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSFTPFileChanged: (id: string, callback: (data: unknown) => void) => {
    const channel = `sftp-file-changed-${id}`
    const sub = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onSFTPProgress: (id: string, callback: (progress: unknown) => void) => {
    const channel = `sftp-progress-${id}`
    const sub = (_: unknown, progress: unknown) => callback(progress)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  onUpdateStatus: (callback: (status: string) => void) => {
    const sub = (_: unknown, status: string) => callback(status)
    ipcRenderer.on('update-status', sub)
    return () => ipcRenderer.removeListener('update-status', sub)
  },
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const sub = (_: unknown, info: unknown) => callback(info)
    ipcRenderer.on('update-available', sub)
    return () => ipcRenderer.removeListener('update-available', sub)
  },
  onUpdateProgress: (callback: (progress: unknown) => void) => {
    const sub = (_: unknown, progress: unknown) => callback(progress)
    ipcRenderer.on('update-progress', sub)
    return () => ipcRenderer.removeListener('update-progress', sub)
  },
  onUpdateError: (callback: (error: string) => void) => {
    const sub = (_: unknown, error: string) => callback(error)
    ipcRenderer.on('update-error', sub)
    return () => ipcRenderer.removeListener('update-error', sub)
  },
  onAppReloadRequest: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('app-reload-request', sub)
    return () => ipcRenderer.removeListener('app-reload-request', sub)
  },

  platform: process.platform,
})
