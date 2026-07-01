/**
 * AI Service for communicating with the Ollama API
 */
export class AiService {
    private static readonly API_URL = 'http://192.168.1.96:11434/api/generate';
    private static readonly MODEL = 'qwen3:4b-instruct';

    /**
     * Generates a response from the AI for a given prompt.
     * @param prompt The user's message
     * @param osInfo Operating system information
     * @returns The AI's response content
     */
    static async generateResponse(prompt: string, osInfo?: string): Promise<string> {
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
                    stream: false,
                }),
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.response || '';
        } catch (error) {
            console.error('[AiService] Error generating response:', error);
            throw error;
        }
    }
}
