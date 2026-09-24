import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Перенаправляем homedir() в изолированную временную директорию, чтобы тесты
// не читали/не писали реальный ~/.minissh_config.json пользователя.
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    const fsMod = await import('node:fs')
    const pathMod = await import('node:path')
    const testRoot = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'yash-config-test-'))
    return {
        ...actual,
        homedir: () => testRoot,
    }
})

import { configPath, DEFAULT_CONFIG, loadConfig, clearConfigCache, saveConfigAsync, saveConfig } from '../electron/src/config.js'
import type { AppConfig } from '../src/types.js'

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const configDir = path.dirname(configPath)

function writeConfig(json: object): void {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(json), 'utf-8')
}

function removeConfig(): void {
    fs.rmSync(configPath, { force: true })
}

function readConfigFile(): AppConfig {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AppConfig
}

/** Полная внешняя копия конфига без clientId (имитация старых данных/импорта). */
function foreignConfigWithoutClientId(): AppConfig {
    const copy = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig
    copy.clientId = ''
    return copy
}

beforeEach(() => {
    removeConfig()
    clearConfigCache()
})

afterAll(() => {
    clearConfigCache()
    fs.rmSync(configDir, { recursive: true, force: true })
})

describe('clientId в loadConfig/saveConfig', () => {
    it('мигрирует старый конфиг без clientId: генерирует и сразу фиксирует на диске', () => {
        // Конфиг «старой версии» — вообще без поля clientId
        writeConfig({ terminalFontName: 'Old Mono', favorites: [] })

        const config = loadConfig()

        expect(config.clientId).toMatch(CLIENT_ID_PATTERN)
        // Значение персистится сразу — следующий запуск увидит тот же id
        expect(readConfigFile().clientId).toBe(config.clientId)
    })

    it('не генерирует clientId заново, если он уже есть в конфиге', () => {
        writeConfig({ clientId: 'fixed-client-id', favorites: [] })

        const config = loadConfig()

        expect(config.clientId).toBe('fixed-client-id')
        expect(readConfigFile().clientId).toBe('fixed-client-id')
    })

    it('clientId стабилен между «запусками» (перезагрузка с диска возвращает тот же id)', () => {
        const firstRun = loadConfig()
        expect(firstRun.clientId).toMatch(CLIENT_ID_PATTERN)

        // Имитация следующего запуска: сброс кэша и повторная загрузка из файла
        clearConfigCache()
        const secondRun = loadConfig()

        expect(secondRun.clientId).toBe(firstRun.clientId)
    })

    it('на чистой установке (без файла) сразу создаёт конфиг со стабильным clientId', () => {
        const config = loadConfig()

        expect(config.clientId).toMatch(CLIENT_ID_PATTERN)
        expect(fs.existsSync(configPath)).toBe(true)
        expect(readConfigFile().clientId).toBe(config.clientId)
    })

    it('не теряет clientId при параллельных saveConfigAsync от внешних копий', async () => {
        const originalClientId = loadConfig().clientId

        const first = foreignConfigWithoutClientId()
        const second = foreignConfigWithoutClientId()

        // Параллельные сохранения «чужих» копий без clientId
        await Promise.all([
            saveConfigAsync(first),
            saveConfigAsync(second)
        ])

        expect(readConfigFile().clientId).toBe(originalClientId)
        expect(loadConfig().clientId).toBe(originalClientId)
    })

    it('сохраняет clientId при синхронном saveConfig внешней копии и восстанавливает его после reload', () => {
        const originalClientId = loadConfig().clientId

        saveConfig(foreignConfigWithoutClientId())

        // Файл на диске не теряет clientId
        expect(readConfigFile().clientId).toBe(originalClientId)

        // Перезагрузка с диска возвращает стабильный id
        clearConfigCache()
        expect(loadConfig().clientId).toBe(originalClientId)
    })
})