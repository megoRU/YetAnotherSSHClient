import { StringDecoder } from 'node:string_decoder'

export const MAX_STREAM_OUTPUT_BYTES = 5 * 1024 * 1024
export const STREAM_OUTPUT_TRUNCATED_NOTICE = '\n[Output truncated: exceeded 5 MB limit]'

/**
 * Накопитель текстового вывода: байтовый лимит с обрезкой и буферизация
 * неполных UTF-8 последовательностей между чанками через StringDecoder
 * (построчный data.toString('utf-8') ломал многобайтовые символы, разрезанные
 * по границе чанка — мохайбек в MCP timeline).
 */
export class StreamOutputCollector {
    private output = ''
    private bytes = 0
    private truncated = false
    private readonly decoder = new StringDecoder('utf-8')

    public write(chunk: Buffer): void {
        if (this.truncated) return
        this.bytes += chunk.length
        if (this.bytes > MAX_STREAM_OUTPUT_BYTES) {
            const remaining = MAX_STREAM_OUTPUT_BYTES - (this.bytes - chunk.length)
            if (remaining > 0) {
                this.output += this.decoder.write(chunk.subarray(0, remaining))
            }
            this.output += this.decoder.end()
            this.output += STREAM_OUTPUT_TRUNCATED_NOTICE
            this.truncated = true
        } else {
            this.output += this.decoder.write(chunk)
        }
    }

    public getOutput(): string {
        return this.output + (this.truncated ? '' : this.decoder.end())
    }
}