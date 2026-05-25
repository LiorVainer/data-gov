/**
 * Shared model ID factory for Mastra agents.
 *
 * Priority:
 * 1. Ollama (OLLAMA_BASE_URL) → local model
 * 2. Anthropic (ANTHROPIC_API_KEY + model starts with "claude-") → direct Anthropic API
 * 3. OpenRouter (default) → "openrouter/{provider}/{model}"
 */

import type { AgentConfig as MastraAgentConfig } from '@mastra/core/agent';
import { AgentConfig } from '../agent.config';
import { getOllamaProvider, getOllamaModelName } from './ollama';

export type SubAgentId = 'datagov' | 'cbs';

const getModelIdForAgent = (agentId?: SubAgentId): string => {
    if (!agentId) return AgentConfig.MODEL.DEFAULT_ID;

    switch (agentId) {
        case 'datagov':
            return AgentConfig.MODEL.DATAGOV_ID;
        case 'cbs':
            return AgentConfig.MODEL.CBS_ID;
    }
};

const isAnthropicModel = (modelId: string): boolean => modelId.startsWith('claude-');

export const getMastraModelId = (agentId?: SubAgentId): string => {
    const modelId = getModelIdForAgent(agentId);
    if (process.env.ANTHROPIC_API_KEY && isAnthropicModel(modelId)) {
        return `anthropic/${modelId}`;
    }
    return `openrouter/${modelId}`;
};

export const getAiSdkModelId = (agentId?: SubAgentId): string => {
    return getModelIdForAgent(agentId);
};

/**
 * Returns a model suitable for Mastra Agent's `model` field.
 * - Ollama configured: returns a LanguageModel object
 * - Anthropic key + claude model: returns "anthropic/{model}" string
 * - Otherwise: returns "openrouter/{model}" string
 */
export const getAgentModel = (agentId?: SubAgentId): MastraAgentConfig['model'] => {
    const ollama = getOllamaProvider();
    if (ollama) {
        return ollama(getOllamaModelName());
    }
    return getMastraModelId(agentId);
};
