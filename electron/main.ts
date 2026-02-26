import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { Client, PseudoTtyOptions } from 'ssh2'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = os.platform() === 'win32'
  ? 'C:\\Users\\savin\\.minissh_config.json'
  : path.join(os.homedir(), '.minissh_config.json')

const DEFAULT_CONFIG = {
  "terminalFontName": "JetBrains Mono",
  "terminalFontSize": 17,
  "uiFontName": "JetBrains Mono",
  "uiFontSize": 12,
  "theme": "Gruvbox Light",
  "favorites": [
    {
      "name": "AEZA_SWE",
      "user": "root",
      "host": "77.110.97.210",
      "port": "12222",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 12 (bookworm)"
    },
    {
      "name": "FirstVDS",
      "user": "root",
      "host": "155.212.170.171",
      "port": "22",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 13 (trixie)"
    },
    {
      "name": "FirstVDS_2",
      "user": "root",
      "host": "83.220.171.209",
      "port": "22",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 13 (trixie)"
    },
    {
      "name": "VEESP_LV",
      "user": "root",
      "host": "45.43.77.237",
      "port": "12222",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 13 (trixie)"
    },
    {
      "name": "4VSP_GE",
      "user": "root",
      "host": "85.208.139.71",
      "port": "12222",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 12 (bookworm)"
    },
    {
      "name": "WAICORE_GE",
      "user": "root",
      "host": "178.17.50.241",
      "port": "12222",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 12 (bookworm)"
    },
    {
      "name": "AEZA",
      "user": "root",
      "host": "89.185.85.197",
      "port": "22",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 12 (bookworm)"
    },
    {
      "name": "beget",
      "user": "root",
      "host": "5.35.87.223",
      "port": "22",
      "password": "",
      "identityFile": "",
      "osPrettyName": "Debian GNU/Linux 13 (trixie)"
    }
  ]
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

const sshClients = new Map<number, Client>()
const shellStreams = new Map<number, any>()

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_, config) => saveConfig(config))

ipcMain.on('ssh-connect', (event, { id, config, cols, rows }) => {
  const sshClient = new Client()
  sshClients.set(id, sshClient)

  sshClient.on('ready', () => {
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
    console.error('SSH client error:', err);
    if (err.code === 'ECONNRESET') {
      // Don't repeat the message if it's just a disconnect
      return;
    }
    event.reply(`ssh-error-${id}`, err.message)
  })

  sshClient.connect({
    host: config.host,
    port: parseInt(config.port) || 22,
    username: config.user,
    password: Buffer.from(config.password || '', 'base64').toString('utf8'),
    readyTimeout: 20000,
  })
})

ipcMain.on('ssh-input', (_, { id, data }) => {
  shellStreams.get(id)?.write(data)
})

ipcMain.on('ssh-resize', (_, { id, cols, rows }) => {
  shellStreams.get(id)?.setWindow(rows, cols, 0, 0)
})

ipcMain.on('ssh-close', (_, id) => {
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
