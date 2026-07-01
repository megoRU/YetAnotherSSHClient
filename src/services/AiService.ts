/**
 * AI Service for communicating with the Ollama API
 */
export class AiService {
    private static readonly API_URL = 'http://192.168.1.96:11434/api/generate';
    private static readonly MODEL = 'qwen3:4b-instruct';

    /**
     * Generates a streaming response from the AI.
     * @param prompt The user's message
     * @param onChunk Callback for each text chunk
     * @param osInfo Operating system information
     */
    static async generateStreamingResponse(
        prompt: string,
        onChunk: (text: string) => void,
        osInfo?: string
    ): Promise<void> {
        const systemPrompt = `Ты — встроенный AI-помощник в SSH-клиенте YetAnotherSSHClient.
Твоя задача: помогать пользователю с командами Linux и администрированием.

Окружение пользователя:
- ОС: ${osInfo || 'Неизвестно (Linux)'}

Требования к ответам:
1. Отвечай максимально кратко и информативно.
2. Не добавляй воду, предисловия и лишние пояснения (никаких "Конечно, вот решение", "Надеюсь, это поможет").
3. Сразу давай решение или последовательность действий.
4. Если вопрос связан с терминалом Linux, приводи готовые команды без лишних комментариев.
5. Учитывай переданную версию ОС и давай команды, совместимые именно с ней.
6. Используй Markdown для форматирования.`;

        const fullPrompt = `System: ${systemPrompt}\n\nUser: ${prompt}`;

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    prompt: fullPrompt,
                    stream: true,
                }),
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) throw new Error('Response body is null');

            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                // Keep the last partial line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.response) {
                            onChunk(json.response);
                        }
                    } catch (e) {
                        console.warn('[AiService] Error parsing chunk:', e, 'Line:', line);
                    }
                }
            }

            // Process any remaining text in the buffer
            if (buffer.trim()) {
                try {
                    const json = JSON.parse(buffer);
                    if (json.response) {
                        onChunk(json.response);
                    }
                } catch (e) {
                    // Ignore error on final potentially incomplete chunk
                }
            }
        } catch (error) {
            console.error('[AiService] Error in streaming response:', error);
            throw error;
        }
    }
}
