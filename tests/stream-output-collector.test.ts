import { describe, it, expect } from 'vitest'
import {
    MAX_STREAM_OUTPUT_BYTES,
    STREAM_OUTPUT_TRUNCATED_NOTICE,
    StreamOutputCollector
} from '../electron/src/mcp/stream-output-collector.js'

describe('StreamOutputCollector', () => {
    it('накапливает обычный текст', () => {
        const collector = new StreamOutputCollector()
        collector.write(Buffer.from('hello '))
        collector.write(Buffer.from('world'))
        expect(collector.getOutput()).toBe('hello world')
    })

    it('не ломает многобайтовые UTF-8, разрезанные между чанками (регрессия StringDecoder)', () => {
        const buf = Buffer.from('Привет, мир!')
        const collector = new StreamOutputCollector()
        for (let i = 0; i < buf.length; i++) {
            collector.write(buf.subarray(i, i + 1))
        }
        expect(collector.getOutput()).toBe('Привет, мир!')
    })

    it('не теряет многобайтовый символ при записи по частям одного чанка', () => {
        const buf = Buffer.from('энд')
        const collector = new StreamOutputCollector()
        for (let i = 0; i < buf.length; i++) {
            collector.write(buf.subarray(i, i + 1))
        }
        expect(collector.getOutput()).toBe('энд')
    })

    it('обрезает вывод при превышении байтового лимита с маркером', () => {
        const collector = new StreamOutputCollector()
        collector.write(Buffer.alloc(MAX_STREAM_OUTPUT_BYTES, 0x61))
        expect(collector.getOutput().length).toBe(MAX_STREAM_OUTPUT_BYTES)
        expect(collector.getOutput()).not.toContain(STREAM_OUTPUT_TRUNCATED_NOTICE)

        collector.write(Buffer.alloc(1024, 0x62))
        const output = collector.getOutput()
        expect(output.length).toBe(MAX_STREAM_OUTPUT_BYTES + STREAM_OUTPUT_TRUNCATED_NOTICE.length)
        expect(output.endsWith(STREAM_OUTPUT_TRUNCATED_NOTICE)).toBe(true)
        expect(output).not.toContain('b'.repeat(1024))
    })

    it('игнорирует запись после обрезки (лимит разовый)', () => {
        const collector = new StreamOutputCollector()
        collector.write(Buffer.alloc(MAX_STREAM_OUTPUT_BYTES + 1, 0x61))
        const afterTruncation = collector.getOutput()
        collector.write(Buffer.from('extra'))
        expect(collector.getOutput()).toBe(afterTruncation)
    })

    it('сохраняет корректный UTF-8 на границе лимита', () => {
        const collector = new StreamOutputCollector()
        const exact = Buffer.alloc(MAX_STREAM_OUTPUT_BYTES - 1, 0x61)
        const tail = Buffer.from('й') // 2 байта, последний - за границей
        collector.write(exact)
        collector.write(tail)
        const output = collector.getOutput()
        expect(output.length).toBe(MAX_STREAM_OUTPUT_BYTES + STREAM_OUTPUT_TRUNCATED_NOTICE.length)
        expect(output.endsWith(STREAM_OUTPUT_TRUNCATED_NOTICE)).toBe(true)
    })
})