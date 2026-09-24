import { dialog } from 'electron'
import { t } from './i18n-main.js'

/** Открывает диалог выбора исполняемого файла/приложения с фильтрами под текущую платформу. */
export async function selectExecutableFile(): Promise<string | null> {
    const filters = process.platform === 'win32'
        ? [{ name: 'Applications', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
        : process.platform === 'darwin'
            ? [{ name: 'Applications', extensions: ['app'] }, { name: 'All Files', extensions: ['*'] }]
            : [{ name: 'All Files', extensions: ['*'] }]
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: t('sftp.openWith'),
        properties: ['openFile'],
        filters
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
}