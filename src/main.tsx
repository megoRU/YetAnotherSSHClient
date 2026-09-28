import {createRoot} from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initRendererLogger } from './utils/rendererLogger.ts'
import { installIpcBridge } from './ipc/tauri-bridge.ts'

// Мост устанавливается до первого рендера: `useConfig` читает конфиг
// синхронно на этапе импорта модулей, поэтому `window.ipcRenderer` должен
// существовать раньше, чем отработает React.
installIpcBridge()

initRendererLogger()

createRoot(document.getElementById('root')!).render(
    <App/>,
)
