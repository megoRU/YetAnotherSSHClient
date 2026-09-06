import { BrowserWindow, app } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { loadConfigAsync, saveConfigAsync } from './config.js'
import { UpdateInfo, UpdateProgress } from '../../src/types.js'

// Настройка логгера для отладки
autoUpdater.logger = console;

// Отключаем автоматическую загрузку, чтобы пользователь мог сам решить
autoUpdater.autoDownload = false
// Отключаем проверку подписи кода (необходимо для неподписанных приложений на macOS и Windows)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(autoUpdater as any).verifyUpdateCodeSignature = false

/**
 * Преобразует releaseNotes (строку, массив строк или массив объектов с описанием) в одну чистую строку.
 */
function formatReleaseNotes(notes: unknown): string | undefined {
    if (!notes) return undefined
    if (typeof notes === 'string') return notes.trim() || undefined
    if (Array.isArray(notes)) {
        const res = notes
            .map(n => {
                if (typeof n === 'string') return n
                if (n && typeof n === 'object') {
                    const item = n as Record<string, unknown>
                    return typeof item.note === 'string' ? item.note : typeof item.releaseNotes === 'string' ? item.releaseNotes : ''
                }
                return ''
            })
            .filter(Boolean)
            .join('\n\n')
            .trim()
        return res || undefined
    }
    if (typeof notes === 'object') {
        const item = notes as Record<string, unknown>
        if (typeof item.note === 'string') return item.note.trim() || undefined
        if (typeof item.releaseNotes === 'string') return item.releaseNotes.trim() || undefined
    }
    return undefined
}

interface ParsedVersion {
    parts: number[]
    prerelease?: string
}

function parseVersion(version: string): ParsedVersion | undefined {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
    if (!match) return undefined

    return {
        parts: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4]
    }
}

function comparePrerelease(left: string, right: string): number {
    const leftParts = left.split('.')
    const rightParts = right.split('.')
    const length = Math.max(leftParts.length, rightParts.length)

    for (let index = 0; index < length; index += 1) {
        const leftPart = leftParts[index]
        const rightPart = rightParts[index]
        if (leftPart === rightPart) continue
        if (leftPart === undefined) return -1
        if (rightPart === undefined) return 1

        const leftIsNumeric = /^\d+$/.test(leftPart)
        const rightIsNumeric = /^\d+$/.test(rightPart)
        if (leftIsNumeric && rightIsNumeric) return Number(leftPart) - Number(rightPart)
        if (leftIsNumeric) return -1
        if (rightIsNumeric) return 1
        return leftPart.localeCompare(rightPart)
    }

    return 0
}

/**
 * Возвращает true, только если candidateVersion действительно новее currentVersion.
 * Нельзя предлагать пользователю более старую версию: GitHub latest может отставать
 * от тестовой или черновой сборки, установленной локально.
 */
export function isVersionNewer(candidateVersion: string, currentVersion: string): boolean {
    const candidate = parseVersion(candidateVersion)
    const current = parseVersion(currentVersion)

    // Безопасное поведение для непредвиденного формата версии — не предлагать downgrade.
    if (!candidate || !current) return false

    for (let index = 0; index < candidate.parts.length; index += 1) {
        if (candidate.parts[index] !== current.parts[index]) {
            return candidate.parts[index] > current.parts[index]
        }
    }

    if (!candidate.prerelease) return Boolean(current.prerelease)
    if (!current.prerelease) return false
    return comparePrerelease(candidate.prerelease, current.prerelease) > 0
}

/**
 * Получает release notes из GitHub API, если electron-updater их не вернул.
 */
async function fetchReleaseNotesFromGithub(version: string): Promise<string | undefined> {
    try {
        const headers = { 'User-Agent': 'YetAnotherSSHClient' }
        let res = await fetch(`https://api.github.com/repos/megoRU/YetAnotherSSHClient/releases/tags/${version}`, { headers })
        if (!res.ok) {
            const altVersion = version.startsWith('v') ? version.slice(1) : `v${version}`
            res = await fetch(`https://api.github.com/repos/megoRU/YetAnotherSSHClient/releases/tags/${altVersion}`, { headers })
        }
        if (res.ok) {
            const data = await res.json() as { body?: string }
            if (data.body && typeof data.body === 'string' && data.body.trim()) {
                return data.body.trim()
            }
        }
    } catch (err) {
        console.error('Failed to fetch release notes from GitHub API:', err)
    }
    return undefined
}

/**
 * Инициализирует слушатели автообновления.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения главного окна.
 */
export function initUpdater(getMainWindow: () => BrowserWindow | null) {
    autoUpdater.on('checking-for-update', () => {
        getMainWindow()?.webContents.send('update-status', 'checking')
    })

    autoUpdater.on('update-available', async (info) => {
        let releaseNotes = formatReleaseNotes(info.releaseNotes)
        if (!releaseNotes && info.version) {
            releaseNotes = await fetchReleaseNotesFromGithub(info.version)
        }
        const updateInfo: UpdateInfo = {
            version: info.version,
            releaseNotes
        }
        getMainWindow()?.webContents.send('update-available', updateInfo)
        getMainWindow()?.webContents.send('update-status', 'available')
    })

    autoUpdater.on('update-not-available', () => {
        getMainWindow()?.webContents.send('update-status', 'not-available')
    })

    autoUpdater.on('error', (err) => {
        console.error('Updater error:', err)
        getMainWindow()?.webContents.send('update-error', err.message)
        getMainWindow()?.webContents.send('update-status', 'error')
    })

    autoUpdater.on('download-progress', (progressObj) => {
        const progress: UpdateProgress = {
            bytesPerSecond: progressObj.bytesPerSecond,
            percent: progressObj.percent,
            total: progressObj.total,
            transferred: progressObj.transferred
        }
        getMainWindow()?.webContents.send('update-progress', progress)
        getMainWindow()?.webContents.send('update-status', 'downloading')
    })

    autoUpdater.on('update-downloaded', () => {
        getMainWindow()?.webContents.send('update-status', 'downloaded')
    })
}

/**
 * Проверяет наличие обновлений.
 *
 * @param {BrowserWindow | null} _mainWindow - Оставлено для совместимости сигнатуры, не используется.
 * @param {boolean} force - Если true, игнорирует суточный лимит.
 */
export async function checkUpdates(_mainWindow: BrowserWindow | null, force: boolean = false) {
    if (process.platform === 'darwin') {
        return { available: false }
    }

    const config = await loadConfigAsync()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    if (!force && config.lastUpdateCheck && (now - config.lastUpdateCheck < ONE_DAY)) {
        return { available: false }
    }

    try {
        const result = await autoUpdater.checkForUpdates()

        config.lastUpdateCheck = now
        await saveConfigAsync(config)

        if (result && result.updateInfo) {
            const currentVersion = app.getVersion()
            const latestVersion = result.updateInfo.version

            // Не предлагаем downgrade, если опубликованная версия старее локальной.
            if (!isVersionNewer(latestVersion, currentVersion)) {
                return { available: false }
            }

            let releaseNotes = formatReleaseNotes(result.updateInfo.releaseNotes)
            if (!releaseNotes) {
                releaseNotes = await fetchReleaseNotesFromGithub(latestVersion)
            }

            return {
                available: true,
                version: latestVersion,
                releaseNotes
            }
        }
        return { available: false }
    } catch (err) {
        console.error('Failed to check for updates:', err)
        return { available: false, error: err instanceof Error ? err.message : String(err) }
    }
}

/**
 * Начинает загрузку обновления.
 */
export async function startUpdateDownload() {
    return await autoUpdater.downloadUpdate()
}

/**
 * Устанавливает обновление и перезапускает приложение.
 */
export function quitAndInstall() {
    autoUpdater.quitAndInstall(true, true)
}
