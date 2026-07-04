import type { ChatMessage } from '../types';

/**
 * AI Service for communicating with the Ollama API
 */
export class AiService {
    /**
     * prod: https://api.megoru.ru/chat
     * local: http://127.0.0.1:8080/chat
     */
    private static readonly API_URL = 'https://api.megoru.ru/chat';

    /**
     * Generates a streaming response from the AI.
     * @param prompt The user's message
     * @param onChunk Callback for each text chunk
     * @param history Chat history
     * @param osInfo Operating system information
     * @param language Interface language
     */
    static async generateStreamingResponse(
        prompt: string,
        onChunk: (text: string) => void,
        history: ChatMessage[] = [],
        osInfo?: string,
        language: 'ru' | 'en' = 'ru'
    ): Promise<void> {
        try {
            // Format history (last 10 messages)
            let finalPrompt = prompt;
            if (history.length > 0) {
                const lastMessages = history.slice(-10);
                const historyText = lastMessages.map(msg => {
                    const roleName = msg.role === 'user' ? 'Пользователь' : 'Помощник';
                    return `${roleName}: ${msg.content}`;
                }).join('\n\n');

                finalPrompt = `История диалога:\n\n${historyText}\n\nТекущее сообщение пользователя:\n\n${prompt}`;
            }

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    osInfo: osInfo || 'Linux',
                    language: language
                }),
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                throw new Error('Response body is null');
            }

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                onChunk(decoder.decode(value, { stream: true }));
            }
        } catch (error) {
            console.error('[AiService] Error in streaming response:', error);
            throw error;
        }
    }
}
