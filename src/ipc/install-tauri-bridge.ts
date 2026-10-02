import { installIpcBridge } from './tauri-bridge'

// Этот модуль должен выполниться до импорта React-компонентов: многие из них
// сохраняют `window.ipcRenderer` в переменную на уровне модуля.
installIpcBridge()
