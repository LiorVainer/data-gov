/**
 * Ollama Provider
 *
 * Creates an OpenAI-compatible AI SDK provider pointing at an Ollama instance.
 * When OLLAMA_BASE_URL is set, this is used instead of OpenRouter.
 */

import { createOpenAI } from '@ai-sdk/openai';

let ollamaProvider: ReturnType<typeof createOpenAI> | null = null;

/**
 * Returns an Ollama-backed provider, or null if OLLAMA_BASE_URL is not configured.
 */
export function getOllamaProvider(): ReturnType<typeof createOpenAI> | null {
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (!baseUrl) return null;

    if (!ollamaProvider) {
        ollamaProvider = createOpenAI({
            baseURL: `${baseUrl.replace(/\/$/, '')}/v1`,
            apiKey: 'ollama', // Ollama doesn't require an API key
        });
    }

    return ollamaProvider;
}

/**
 * Returns the configured Ollama model name, defaulting to 'qwen2.5'.
 */
export function getOllamaModelName(): string {
    return process.env.OLLAMA_MODEL ?? 'qwen2.5';
}
