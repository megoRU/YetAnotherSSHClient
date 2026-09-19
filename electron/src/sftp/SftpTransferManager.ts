import { sftpClients, sftpTransferClients } from '../ssh-manager.js'

export class SftpTransferManagerService {
    public cancelUpload(payload: { id: string; remotePath?: string; transferId?: string }): boolean {
        const { id, transferId } = payload

        if (transferId) {
            const transferSftp = sftpTransferClients.get(transferId)
            if (transferSftp) {
                console.log(`[SFTP] Cancelling specific transfer: ${transferId}`)
                transferSftp.end()
                sftpTransferClients.delete(transferId)
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
}
