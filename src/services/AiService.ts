/**
 * AI Service for communicating with the Ollama API
 */
export class AiService {
    private static readonly API_URL = 'https://api.megoru.ru/chat';

    /**
     * Generates a streaming response from the AI.
     * @param prompt The user's message
     * @param onChunk Callback for each text chunk
     * @param osInfo Operating system information
     * @param language Interface language
     */
    static async generateStreamingResponse(
        prompt: string,
        onChunk: (text: string) => void,
        osInfo?: string,
        language: 'ru' | 'en' = 'ru'
    ): Promise<void> {
        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    osInfo: osInfo || 'Linux',
                    language: language
                }),
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) throw new Error('Response body is null');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                onChunk(chunk);
            }
        } catch (error) {
            console.error('[AiService] Error in streaming response:', error);
            throw error;
        }
    }
}
