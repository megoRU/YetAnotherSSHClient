import { app, BrowserWindow } from 'electron'
import { loadConfig, saveConfig } from './config.js'

/**
 * Сравнивает две версии в формате x.y.z.
 *
 * @param {string} latest - Новая версия.
 * @param {string} current - Текущая версия приложения.
 * @returns {boolean} True, если доступна более новая версия.
 */
export function isNewerVersion(latest: string, current: string): boolean {
    const l = latest.split('.').map(Number)
    const c = current.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if (l[i] > (c[i] || 0)) return true
        if (l[i] < (c[i] || 0)) return false
    }
    return false
}

/**
 * Проверяет наличие обновлений на GitHub.
 * Если найдена новая версия, отправляет сообщение 'update-available' в основное окно.
 * Проверка выполняется не чаще раза в сутки.
 *
 * @param {BrowserWindow | null} mainWindow - Окно приложения для отправки уведомлений.
 * @param {boolean} force - Если true, игнорирует суточный лимит на проверку.
 */
export async function checkUpdates(mainWindow: BrowserWindow | null, force = false) {
    const config = loadConfig()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    if (!force && config.lastUpdateCheck && (now - config.lastUpdateCheck < ONE_DAY)) {
        return
    }

    try {
        const GITHUB_API_URL = "https://api.github.com/repos/megoRU/YetAnotherSSHClient/releases/latest"
        const response = await fetch(GITHUB_API_URL, {
            headers: { 'User-Agent': 'YetAnotherSSHClient' }
        })
        if (!response.ok) return

        const data = await response.json() as { tag_name: string, html_url: string }
        const latestVersion = data.tag_name.replace(/^v/, '')
        const currentVersion = app.getVersion()

        if (isNewerVersion(latestVersion, currentVersion)) {
            mainWindow?.webContents.send('update-available', {
                version: latestVersion,
                url: data.html_url
            })
        }

        config.lastUpdateCheck = now
        saveConfig(config)
    } catch (err) {
        console.error('Failed to check for updates:', err)
    }
}
