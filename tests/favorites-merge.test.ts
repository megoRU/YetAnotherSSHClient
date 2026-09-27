import { describe, it, expect } from 'vitest'
import type { SSHConfig } from '../src/types.js'
import { upsertFavorite } from '../src/utils/index.js'

const server = (overrides: Partial<SSHConfig> = {}): SSHConfig => ({
    id: 'srv-1',
    name: 'server',
    user: 'root',
    host: '10.0.0.1',
    port: 22,
    ...overrides
})

describe('upsertFavorite', () => {
    it('добавляет новый сервер, если список пуст', () => {
        const added = server({ id: 'srv-1' })
        expect(upsertFavorite([], added)).toEqual([added])
    })

    it('не затирает существующий сервер с тем же адресом при добавлении нового', () => {
        const existing = server({ id: 'srv-1', name: 'production' })
        const added = server({ id: 'srv-2', name: 'staging' })

        const result = upsertFavorite([existing], added)

        expect(result).toHaveLength(2)
        expect(result[0]).toEqual(existing)
        expect(result[1]).toEqual(added)
    })

    it('не затирает существующий сервер с тем же host/user/port без id', () => {
        const existing = server({ id: 'srv-1', name: 'production' })
        const added = { ...server(), id: undefined }

        const result = upsertFavorite([existing], added)

        expect(result).toHaveLength(2)
        expect(result[0].id).toBe('srv-1')
        expect(result[1].id).toBeUndefined()
    })

    it('обновляет сервер по его id, не меняя позицию', () => {
        const first = server({ id: 'srv-1', name: 'production' })
        const second = server({ id: 'srv-2', name: 'staging', host: '10.0.0.2' })

        const result = upsertFavorite([first, second], server({ id: 'srv-1', name: 'renamed' }))

        expect(result).toHaveLength(2)
        expect(result[0]).toEqual(server({ id: 'srv-1', name: 'renamed' }))
        expect(result[1]).toBe(second)
    })

    it('при правке сервера не переписывает другую запись с тем же адресом', () => {
        const first = server({ id: 'srv-1', name: 'production' })
        const second = server({ id: 'srv-2', name: 'staging' })

        const result = upsertFavorite([first, second], server({ id: 'srv-2', name: 'staging', port: 2222 }))

        expect(result).toHaveLength(2)
        expect(result[0]).toBe(first)
        expect(result[1].port).toBe(2222)
    })

    it('не мутирует исходный массив', () => {
        const favorites = [server({ id: 'srv-1' })]
        const snapshot = [...favorites]

        upsertFavorite(favorites, server({ id: 'srv-2' }))

        expect(favorites).toEqual(snapshot)
    })
})
