import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { Client, PseudoTtyOptions } from 'ssh2'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(os.homedir(), '.minissh_config.json')

const DEFAULT_CONFIG = {
  "terminalFontName": "JetBrains Mono",
  "terminalFontSize": 17,
  "uiFontName": "JetBrains Mono",
  "uiFontSize": 12,
  "theme": "Gruvbox Light",
  "favorites": []
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1254,
    height: 909,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'YetAnotherSSHClient'
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

const sshClients = new Map<string, Client>()
const shellStreams = new Map<string, any>()

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_, config) => saveConfig(config))

ipcMain.on('ssh-connect', (event, { id, config, cols, rows }) => {
  if (sshClients.has(id)) {
    console.log(`[SSH] Cleaning up existing connection for ID ${id}`);
    sshClients.get(id)?.end();
    shellStreams.delete(id);
    sshClients.delete(id);
  }

  const sshClient = new Client()
  sshClients.set(id, sshClient)

  sshClient.on('ready', () => {
    console.log(`[SSH] Connection ready for ID ${id} (${config.user}@${config.host}:${config.port || 22})`);
    event.reply(`ssh-status-${id}`, 'SSH Connection Established')

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
        event.reply(`ssh-output-${id}`, chunk.toString())
      })
      stream.on('close', () => {
        sshClient.end()
        event.reply(`ssh-status-${id}`, 'SSH Connection Closed')
      })
    })
  })

  sshClient.on('error', (err: any) => {
    if (!sshClients.has(id)) {
      console.warn(`[SSH] Ignoring error for already cleaned ID: ${id}`);
      return;
    }

    console.error(`[SSH] Connection error [ID: ${id}, Host: ${config.host}]:`, err);
    event.reply(`ssh-error-${id}`, err.message);

    // Clean up
    sshClients.get(id)?.end();
    shellStreams.delete(id);
    sshClients.delete(id);
  })

  const password = Buffer.from(config.password || '', 'base64').toString('utf8');
  console.log(`[SSH] Initiating connection [ID: ${id}]`);
  console.log(`[SSH] Config: user=${config.user}, host=${config.host}, port=${config.port || 22}, password_len=${password.length}`);

  sshClient.connect({
    host: config.host,
    port: parseInt(config.port) || 22,
    username: config.user,
    password: password,
    readyTimeout: 20000,
    debug: (msg: string) => {
      if (msg.includes('DEBUG: ')) {
         console.log(`[SSH-DEBUG ID: ${id}] ${msg}`);
      }
    }
  })
})

ipcMain.on('ssh-input', (_, { id, data }) => {
  shellStreams.get(id)?.write(data)
})

ipcMain.on('ssh-resize', (_, { id, cols, rows }) => {
  shellStreams.get(id)?.setWindow(rows, cols, 0, 0)
})

ipcMain.on('ssh-close', (_, id: string) => {
  console.log(`[SSH] Closing connection [ID: ${id}]`);
  shellStreams.get(id)?.end()
  sshClients.get(id)?.end()
  shellStreams.delete(id)
  sshClients.delete(id)
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
})
