import { BrowserWindow } from 'electron'
import { setConfirmationMainWindowGetter } from './mcp/confirmation-manager.js'

export {
    getMcpStatus,
    getMcpToken,
    handleMcpConfirmationResponse,
    startMcpServer,
    stopMcpServer,
    syncMcpServerState
} from './mcp/server.js'


export function setMcpMainWindowGetter(getter: () => BrowserWindow | null) {
    setConfirmationMainWindowGetter(getter)
}
