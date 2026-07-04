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

    static async generateStreamingResponse(
        prompt: string,
        onChunk: (text: string) => void,
        history: ChatMessage[] = [],
        osInfo?: string,
        language: 'ru' | 'en' = 'ru'
    ): Promise<void> {
        try {
            let finalPrompt = prompt;

            if (history.length > 0) {
                const isRu = language === 'ru';
                const userLabel = isRu ? 'Пользователь' : 'User';
                const assistantLabel = isRu ? 'Помощник' : 'Assistant';
                const historyTitle = isRu ? 'История диалога:' : 'Dialogue History:';
                const currentMsgTitle = isRu ? 'Текущее сообщение пользователя:' : 'Current user message:';

                const historyText = history
                    .slice(-10)
                    .map(msg => {
                        const role = msg.role === 'user' ? userLabel : assistantLabel;
                        return `${role}: ${msg.content}`;
                    })
                    .join('\n\n');

                finalPrompt = `${historyTitle}\n\n${historyText}\n\n${currentMsgTitle}\n\n${prompt}`;
            }

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    osInfo: osInfo || 'Linux',
                    language,
                }),
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body?.getReader();

            if (!reader) {
                throw new Error('Response body is null');
            }

            const decoder = new TextDecoder();

            let buffer = '';
            let lastFlush = performance.now();

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    buffer += decoder.decode();

                    if (buffer.length > 0) {
                        onChunk(buffer);
                    }

                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                const now = performance.now();
                console.log(value.length, JSON.stringify(decoder.decode(value, { stream: true })));
                if (buffer.length >= 32 || now - lastFlush >= 30) {
                    onChunk(buffer);
                    buffer = '';
                    lastFlush = now;
                }
            }
        } catch (error) {
            console.error('[AiService] Error in streaming response:', error);
            throw error;
        }
    }
}