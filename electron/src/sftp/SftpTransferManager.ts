import type { SFTPWrapper } from 'ssh2'
import { sftpClients } from '../ssh-manager.js'
import { removeRemotePath } from './sftp-utils.js'

export type TransferLifecycleState = 'ACTIVE' | 'COMPLETING' | 'CANCELLING'

export class SftpTransferManagerService {
    private transferClients = new Map<string, SFTPWrapper>()
    private transferSessionMap = new Map<string, string>()
    private transferTempPaths = new Map<string, string>()
    private transferStates = new Map<string, TransferLifecycleState>()

    public cancelHook?: (sessionId: string) => void
    public cancelTransferHook?: (transferId: string) => void
    public sessionClosedHook?: (sessionId: string) => void

    public registerTransfer(sessionId: string, transferId: string, sftp: SFTPWrapper, tempRemotePath?: string): void {
        this.transferClients.set(transferId, sftp)
        this.transferSessionMap.set(transferId, sessionId)
        this.transferStates.set(transferId, 'ACTIVE')
        if (tempRemotePath) {
            this.transferTempPaths.set(transferId, tempRemotePath)
        }
    }

    public unregisterTransfer(transferId: string): void {
        this.transferClients.delete(transferId)
        this.transferSessionMap.delete(transferId)
        this.transferTempPaths.delete(transferId)
        this.transferStates.delete(transferId)
    }

    public isTransferActive(transferId: string): boolean {
        return this.transferStates.get(transferId) === 'ACTIVE'
    }

    public tryStartCompleting(transferId: string): boolean {
        const currentState = this.transferStates.get(transferId)
        if (currentState === 'ACTIVE') {
            this.transferStates.set(transferId, 'COMPLETING')
            return true
        }
        return false
    }

    public getTransferClient(transferId: string): SFTPWrapper | undefined {
        return this.transferClients.get(transferId)
    }

    public async cancelTransfer(payload: { id: string; remotePath?: string; transferId?: string }): Promise<boolean> {
        const { id, transferId } = payload

        if (transferId) {
            const currentState = this.transferStates.get(transferId)
            if (!currentState || currentState !== 'ACTIVE') {
                return false
            }

            this.transferStates.set(transferId, 'CANCELLING')

            this.cancelTransferHook?.(transferId)

            // Transfer остаётся зарегистрированным до тех пор, пока worker job
            // фактически не завершится (unregister делает сервис в finally).
            // Состояние CANCELLING гасит прогресс (isTransferActive === false)
            // и запрещает промоут temp-пути (tryStartCompleting === false);
            // повторный cancel возвращает false и безопасен.
            const tempRemotePath = this.transferTempPaths.get(transferId)

            if (tempRemotePath) {
                // Temp-путь создавался через per-transfer sftp-канал (transferClient),
                // поэтому и удалять его нужно этим же каналом. Fallback на сессионный
                // sftpClients не используется: он может указывать на другую/уже
                // закрытую сессию и удалить чужой temp-файл.
                const transferClient = this.transferClients.get(transferId)
                if (transferClient) {
                    try {
                        await removeRemotePath(transferClient, tempRemotePath)
                    } catch (err) {
                        console.error(`[SFTP] Cleanup error for temp path ${tempRemotePath} during cancellation:`, err)
                    }
                }
            }

            return true
        } else {
            this.cancelHook?.(id)
            const sftp = sftpClients.get(id)
            if (sftp) {
                sftp.end()
                sftpClients.delete(id)
            }
            return true
        }
    }

    public async cleanupSessionTransfers(sessionId: string): Promise<void> {
        for (const [transferId, sId] of Array.from(this.transferSessionMap.entries())) {
            if (sId !== sessionId) continue
            const transferClient = this.transferClients.get(transferId)
            const tempRemotePath = this.transferTempPaths.get(transferId)
            if (transferClient) {
                if (tempRemotePath) {
                    // Удаляем temp ПОКА живёт канал: удаление — это серия SSH-запросов,
                    // поэтому end() до его завершения (fire-and-forget) оставил бы
                    // temp-файл/папку на сервере.
                    try {
                        await removeRemotePath(transferClient, tempRemotePath)
                    } catch (e) {
                        console.error(`[SFTP] Failed to clean up temp file ${tempRemotePath} on session cleanup:`, e)
                    }
                }
                try {
                    transferClient.removeAllListeners()
                    transferClient.end()
                } catch (e) {
                    console.error(`[SFTP] Error cleaning up transfer ${transferId}:`, e)
                }
            }
            this.unregisterTransfer(transferId)
        }
        this.sessionClosedHook?.(sessionId)
    }

    public cleanupAllTransfers(): void {
        const sessions = new Set<string>(this.transferSessionMap.values())
        sessions.forEach(sessionId => {
            this.sessionClosedHook?.(sessionId)
        })
        this.transferClients.forEach(s => {
            try {
                s.removeAllListeners()
                s.end()
            } catch { /* ignore */ }
        })
        this.transferClients.clear()
        this.transferSessionMap.clear()
        this.transferTempPaths.clear()
        this.transferStates.clear()
    }
}

export const sftpTransferManager = new SftpTransferManagerService()
