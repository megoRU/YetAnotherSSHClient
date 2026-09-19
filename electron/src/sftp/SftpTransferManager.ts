import type { SFTPWrapper } from 'ssh2'
import { sftpClients } from '../ssh-manager.js'

export class SftpTransferManagerService {
    private transferClients = new Map<string, SFTPWrapper>()
    private transferSessionMap = new Map<string, string>()

    public registerTransfer(sessionId: string, transferId: string, sftp: SFTPWrapper): void {
        this.transferClients.set(transferId, sftp)
        this.transferSessionMap.set(transferId, sessionId)
    }

    public unregisterTransfer(transferId: string): void {
        const sftp = this.transferClients.get(transferId)
        if (sftp) {
            this.transferClients.delete(transferId)
            this.transferSessionMap.delete(transferId)
        }
    }

    public isTransferActive(transferId: string): boolean {
        return this.transferClients.has(transferId)
    }

    public getTransferClient(transferId: string): SFTPWrapper | undefined {
        return this.transferClients.get(transferId)
    }

    public cancelTransfer(payload: { id: string; remotePath?: string; transferId?: string }): boolean {
        const { id, transferId } = payload

        if (transferId) {
            const transferSftp = this.transferClients.get(transferId)
            if (transferSftp) {
                console.log(`[SFTP] Cancelling specific transfer: ${transferId}`)
                try {
                    transferSftp.end()
                } catch (e) {
                    console.error(`[SFTP] Error ending transfer channel ${transferId}:`, e)
                }
                this.unregisterTransfer(transferId)
            }
        } else {
            const sftp = sftpClients.get(id)
            if (sftp) {
                console.log(`[SFTP] Cancelling main SFTP session for ID: ${id}`)
                sftp.end()
                sftpClients.delete(id)
            }
        }
        return true
    }

    public cleanupSessionTransfers(sessionId: string): void {
        this.transferSessionMap.forEach((sId, transferId) => {
            if (sId === sessionId) {
                const transferClient = this.transferClients.get(transferId)
                if (transferClient) {
                    try {
                        transferClient.removeAllListeners()
                        transferClient.end()
                    } catch (e) {
                        console.error(`[SFTP] Error cleaning up transfer ${transferId}:`, e)
                    }
                }
                this.transferClients.delete(transferId)
                this.transferSessionMap.delete(transferId)
            }
        })
    }

    public cleanupAllTransfers(): void {
        this.transferClients.forEach(s => {
            try {
                s.removeAllListeners()
                s.end()
            } catch { /* ignore */ }
        })
        this.transferClients.clear()
        this.transferSessionMap.clear()
    }
}

export const sftpTransferManager = new SftpTransferManagerService()
