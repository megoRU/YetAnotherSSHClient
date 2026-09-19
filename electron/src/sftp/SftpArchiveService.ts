import * as path from 'node:path'
import { sshClients } from '../ssh-manager.js'
import { t } from '../i18n-main.js'
import { escapeRemotePath } from './sftp-utils.js'

export class SftpArchiveService {
    public async extract(payload: { id: string; remotePath: string }): Promise<boolean> {
        const { id, remotePath } = payload
        console.log(`[SFTP] Extracting archive: ${remotePath} (ID: ${id})`)
        const client = sshClients.get(id)
        if (!client) throw new Error(t('errors.sshClientNotFound'))

        const ext = path.extname(remotePath).toLowerCase()
        const dir = path.dirname(remotePath)
        let cmd = ''

        const escapedPath = escapeRemotePath(remotePath)
        const escapedDir = escapeRemotePath(dir)

        if (ext === '.zip') {
            cmd = `unzip -o ${escapedPath} -d ${escapedDir}`
        } else if (ext === '.tar') {
            cmd = `tar -xf ${escapedPath} -C ${escapedDir}`
        } else if (ext === '.gz' || ext === '.tgz') {
            cmd = `tar -xzf ${escapedPath} -C ${escapedDir}`
        } else if (ext === '.bz2') {
            cmd = `tar -xjf ${escapedPath} -C ${escapedDir}`
        } else {
            throw new Error(t('errors.unsupportedArchive'))
        }

        return new Promise((resolve, reject) => {
            client.exec(cmd, (err, stream) => {
                if (err) return reject(err)
                let errorOutput = ''
                stream.stderr.on('data', (data: Buffer) => {
                    errorOutput += data.toString()
                })
                stream.on('close', (code: number) => {
                    if (code === 0) resolve(true)
                    else reject(new Error(errorOutput || t('errors.extractError', { code: String(code) })))
                })
            })
        })
    }
}
