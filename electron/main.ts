import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { Client, PseudoTtyOptions } from 'ssh2'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import net from 'node:net'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(os.homedir(), '.minissh_config.json')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(createWindow)

  app.on('before-quit', () => {
    console.log('[App] Quitting... cleaning up all SSH connections.');
    shellStreams.forEach(s => { try { s.destroy(); } catch(e) {} });
    sshClients.forEach(c => { try { c.destroy(); } catch(e) {} });
    sshSockets.forEach(s => { try { s.destroy(); } catch(e) {} });
    shellStreams.clear();
    sshClients.clear();
    sshSockets.clear();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

const DEFAULT_CONFIG = {
  "terminalFontName": "JetBrains Mono",
  "terminalFontSize": 17,
  "uiFontName": "JetBrains Mono",
  "uiFontSize": 12,
  "theme": "Gruvbox Light",
  "favorites": [],
  "x": 353,
  "y": 141,
  "width": 1254,
  "height": 909,
  "maximized": false
}

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch (e) {
      return DEFAULT_CONFIG
    }
  }
  return DEFAULT_CONFIG
}

function saveConfig(config: any) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

let mainWindow: BrowserWindow | null

function getThemeColor(theme: string) {
  switch (theme) {
    case 'Dark': return '#1e1e1e'
    case 'Gruvbox Light': return '#fbf1c7'
    case 'Light':
    default: return '#ffffff'
  }
}

function createWindow() {
  const config = loadConfig()

  mainWindow = new BrowserWindow({
    x: config.x,
    y: config.y,
    width: config.width,
    height: config.height,
    backgroundColor: getThemeColor(config.theme),
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'YetAnotherSSHClient'
  })

  if (config.maximized) {
    mainWindow.maximize()
  }

  let saveTimeout: any = null
  const saveWindowState = () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      if (!mainWindow) return
      const bounds = mainWindow.getBounds()
      const isMaximized = mainWindow.isMaximized()
      const currentConfig = loadConfig()

      // Only update bounds if not maximized to preserve previous size
      if (!isMaximized) {
        currentConfig.x = bounds.x
        currentConfig.y = bounds.y
        currentConfig.width = bounds.width
        currentConfig.height = bounds.height
      }
      currentConfig.maximized = isMaximized
      saveConfig(currentConfig)
    }, 500)
  }

  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('maximize', saveWindowState)
  mainWindow.on('unmaximize', saveWindowState)

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })

  const themeParam = `?theme=${encodeURIComponent(config.theme)}`
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL + themeParam)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { theme: config.theme } })
  }
}

const sshClients = new Map<string, Client>()
const shellStreams = new Map<string, any>()
const sshSockets = new Map<string, net.Socket>()

ipcMain.handle('get-system-fonts', async () => {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('powershell -command "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name"')
      return stdout.split('\r\n').filter(Boolean).sort()
    } else if (process.platform === 'linux') {
      const { stdout } = await execAsync('fc-list : family | cut -d, -f1 | sort | uniq')
      return stdout.split('\n').filter(Boolean).map(f => f.trim())
    } else if (process.platform === 'darwin') {
      const { stdout } = await execAsync('system_profiler SPFontsDataType | grep "Full Name" | cut -d: -f2')
      return stdout.split('\n').filter(Boolean).map(f => f.trim()).sort()
    }
  } catch (e) {
    console.error('Failed to get system fonts:', e)
  }
  return ['JetBrains Mono', 'Courier New', 'Consolas', 'Monaco', 'monospace']
})

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_, config) => saveConfig(config))

ipcMain.on('ssh-connect', (event, { id, config, cols, rows }) => {
  if (sshClients.has(id) || sshSockets.has(id)) {
    console.log(`[SSH] Cleaning up existing connection/socket for ID ${id}`);
    sshSockets.get(id)?.destroy();
    sshClients.get(id)?.end();
    sshSockets.delete(id);
    shellStreams.delete(id);
    sshClients.delete(id);
  }

  const sshClient = new Client()
  sshClients.set(id, sshClient)

  sshClient.on('ready', () => {
    console.log(`[SSH] Connection ready for ID ${id} (${config.user}@${config.host}:${config.port || 22})`);
    event.reply(`ssh-status-${id}`, 'Установлено SSH-соединение')

    const pty: PseudoTtyOptions = {
      rows: rows || 24,
      cols: cols || 80,
      term: 'xterm-256color'
    }

    sshClient.shell(pty, (err, stream) => {
      if (err) {
        event.reply(`ssh-error-${id}`, err.message)
        return
      }
      shellStreams.set(id, stream)
      stream.on('data', (chunk: Buffer) => {
        event.reply(`ssh-output-${id}`, chunk)
      })
      stream.on('close', () => {
        sshClient.end()
        event.reply(`ssh-status-${id}`, 'SSH-соединение закрыто')
      })
    })
  })

  sshClient.on('error', (err: any) => {
    console.error(`[SSH] Connection error [ID: ${id}, Host: ${config.host}]:`, err);

    if (!sshClients.has(id)) {
      console.warn(`[SSH] Ignoring error for already cleaned ID: ${id}`);
      return;
    }

    event.reply(`ssh-error-${id}`, err.message);

    // Clean up
    sshClients.get(id)?.end();
    shellStreams.delete(id);
    sshClients.delete(id);
  })

  const password = Buffer.from(config.password || '', 'base64').toString('utf8');
  console.log(`[SSH] Initiating connection [ID: ${id}]`);
  console.log(`[SSH] Config: user=${config.user}, host=${config.host}, port=${config.port || 22}, password_len=${password.length}`);

  const port = parseInt(config.port) || 22;
  const host = config.host;

  const sock = net.connect(port, host);
  sshSockets.set(id, sock);

  sock.on('connect', () => {
    console.log(`[SSH] TCP Socket connected for ID ${id}, setting noDelay: true`);
    sock.setNoDelay(true); // Disable Nagle's algorithm for low latency typing

    sshClient.connect({
      sock: sock,
      username: config.user,
      password: password,
      readyTimeout: 20000,
      debug: (msg: string) => {
        if (msg.includes('DEBUG: ')) {
           console.log(`[SSH-DEBUG ID: ${id}] ${msg}`);
        }
      }
    });
  });

  sock.on('error', (err) => {
    console.error(`[SSH] TCP Socket error [ID: ${id}]:`, err);
    if (sshSockets.has(id)) {
      event.reply(`ssh-error-${id}`, `Socket error: ${err.message}`);
      sock.destroy();
      sshClients.get(id)?.end();
      sshSockets.delete(id);
      shellStreams.delete(id);
      sshClients.delete(id);
    }
  });
})

ipcMain.on('ssh-input', (_, { id, data }) => {
  const stream = shellStreams.get(id);
  if (stream) {
    stream.write(data);
  }
})

ipcMain.on('ssh-resize', (_, { id, cols, rows }) => {
  shellStreams.get(id)?.setWindow(rows, cols, 0, 0)
})

ipcMain.on('ssh-get-os-info', (event, id) => {
  const client = sshClients.get(id);
  if (!client) return;

  client.exec('cat /etc/os-release', (err, stream) => {
    if (err) {
      console.error(`[SSH] exec error for ID ${id}:`, err);
      return;
    }
    let data = '';
    stream.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    stream.on('close', () => {
      event.reply(`ssh-os-info-${id}`, data);
    });
  });
});

ipcMain.on('ssh-close', (_, id: string) => {
  console.log(`[SSH] Closing connection [ID: ${id}]`);
  try { shellStreams.get(id)?.destroy(); } catch(e) {}
  try { sshClients.get(id)?.destroy(); } catch(e) {}
  try { sshSockets.get(id)?.destroy(); } catch(e) {}
  shellStreams.delete(id)
  sshClients.delete(id)
  sshSockets.delete(id)
})

ipcMain.on('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.on('window-close', () => {
  mainWindow?.close()
  app.quit()
})

ipcMain.on('open-external', (_, url: string) => {
  shell.openExternal(url)
})
