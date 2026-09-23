import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('../electron/src/sftp/sftp-progress-batcher.js', () => ({
    sftpProgressBatcher: { push: vi.fn() }
}))

import {
    aggregateTransferProgress,
    createTransferProgressReporter,
    createTransferState,
    ratioTransferProgress
} from '../electron/src/sftp/sftp-transfer-common.js'
import { sftpProgressBatcher } from '../electron/src/sftp/sftp-progress-batcher.js'

afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
})

function createReporter(overrides: Partial<Parameters<typeof createTransferProgressReporter>[0]> = {}) {
    let active = true
    let win: unknown = { webContents: { send: vi.fn() } }
    return {
        reporter: createTransferProgressReporter({
            sessionId: 's1',
            transferId: 't1',
            type: 'upload',
            getWin: () => win as never,
            isActive: () => active,
            ...overrides
        }),
        setActive: (value: boolean) => { active = value },
        setWin: (value: unknown) => { win = value }
    }
}

describe('aggregateTransferProgress', () => {
    it('пустой трансфер (total=0) считается выполненным', () => {
        expect(aggregateTransferProgress({ transferred: 0, total: 0, rootPath: '/' })).toBe(100)
    })

    it('считает долю и не может превысить 100 (гонка transferred>total)', () => {
        expect(aggregateTransferProgress({ transferred: 50, total: 100, rootPath: '/' })).toBe(50)
        expect(aggregateTransferProgress({ transferred: 150, total: 100, rootPath: '/' })).toBe(100)
        expect(aggregateTransferProgress({ transferred: 99.6, total: 100, rootPath: '/' })).toBe(100)
    })
})

describe('ratioTransferProgress', () => {
    it('падение на ноль в total возвращает fallback', () => {
        expect(ratioTransferProgress(0, 0, 0)).toBe(0)
        expect(ratioTransferProgress(100, 0, 42)).toBe(42)
    })

    it('считает процент отдельного файла', () => {
        expect(ratioTransferProgress(25, 100, 0)).toBe(25)
        expect(ratioTransferProgress(100, 100, 0)).toBe(100)
    })
})

describe('createTransferState', () => {
    it('нормализует falsy total в 0 и сохраняет валидный', () => {
        expect(createTransferState('/', 0)).toEqual({ transferred: 0, total: 0, rootPath: '/' })
        expect(createTransferState('/tmp', 42)).toEqual({ transferred: 0, total: 42, rootPath: '/tmp' })
    })

    it('отрицательный total трактуется агрегатором как завершённый (total <= 0)', () => {
        expect(aggregateTransferProgress(createTransferState('/tmp', -5))).toBe(100)
    })
})

describe('createTransferProgressReporter', () => {
    it('не отправляет события для неактивного трансфера', () => {
        const { reporter, setActive } = createReporter()
        setActive(false)
        reporter.emit('/a', 50)
        expect(sftpProgressBatcher.push).not.toHaveBeenCalled()
    })

    it('троттлит промежуточный прогресс (максимум раз в 100 мс)', () => {
        vi.useFakeTimers()
        const { reporter } = createReporter()
        reporter.emit('/a', 10)
        reporter.emit('/a', 20)
        expect(sftpProgressBatcher.push).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(100)
        reporter.emit('/a', 30)
        expect(sftpProgressBatcher.push).toHaveBeenCalledTimes(2)
    })

    it('финальный прогресс 100 не троттлится', () => {
        vi.useFakeTimers()
        const { reporter } = createReporter()
        reporter.emit('/a', 10)
        reporter.emit('/a', 100)
        expect(sftpProgressBatcher.push).toHaveBeenCalledTimes(2)
    })

    it('отправляет финальное значение transferred/total', () => {
        const { reporter } = createReporter()
        reporter.emit('/a', 100, 99, 100)
        expect(sftpProgressBatcher.push).toHaveBeenCalledWith(
            's1',
            expect.any(Object),
            expect.objectContaining({ id: 't1', remotePath: '/a', progress: 100, transferred: 99, total: 100, type: 'upload' })
        )
    })

    it('пропускает событие при отсутствии окна, но не вешает апдейты после него', () => {
        vi.useFakeTimers()
        const { reporter, setWin } = createReporter()
        setWin(null)
        reporter.emit('/a', 10)
        expect(sftpProgressBatcher.push).not.toHaveBeenCalled()
        setWin({ webContents: { send: vi.fn() } })
        vi.advanceTimersByTime(100)
        reporter.emit('/a', 20)
        expect(sftpProgressBatcher.push).toHaveBeenCalledTimes(1)
    })
})