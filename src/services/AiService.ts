/**
 * AI Service for communicating with the Ollama API
 */
export class AiService {
    private static readonly API_URL = 'http://192.168.1.96:11434/api/generate';
    private static readonly MODEL = 'qwen3:4b-instruct';

    /**
     * Generates a response from the AI for a given prompt.
     * @param prompt The user's message
     * @returns The AI's response content
     */
    static async generateResponse(prompt: string): Promise<string> {
        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    prompt: prompt,
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
