/**
 * Routing Agent (Orchestrator)
 *
 * Routes user queries to specialized sub-agents based on intent.
 * Memory is required for Mastra agent network execution.
 */

import { Agent, type AgentConfig as MastraAgentConfig } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ConvexVector } from '@mastra/convex';
import { openrouter } from '@openrouter/ai-sdk-provider';
import {
    UnicodeNormalizer,
} from '@mastra/core/processors';
import { getAgentModel } from '../model';
import { getOllamaProvider, getOllamaModelName } from '../ollama';
import { ROUTING_CONFIG } from './config';
import { AgentConfig } from '../../agent.config';
import { AGENT_SCORERS } from '../../evals/eval.config';
import { ClientTools } from '@/lib/tools/client';
import { cbsAgent } from '../cbs';
import { datagovAgent } from '../datagov';
import { TruncateToolResultsProcessor } from '../../processors/truncate-tool-results.processor';
import { ENV } from '@/lib/env';

const { MEMORY } = AgentConfig;

const convexUrl = ENV.NEXT_PUBLIC_CONVEX_URL;
const convexAdminKey = ENV.CONVEX_ADMIN_KEY;

const vector =
    convexUrl && convexAdminKey
        ? new ConvexVector({
              id: 'convex-vector',
              deploymentUrl: convexUrl,
              adminAuthToken: convexAdminKey,
          })
        : undefined;

/** Fast, cheap model for security classification processors (OpenRouter only) */
const GUARD_MODEL = 'openrouter/google/gemini-2.5-flash-lite';

/** Factory: creates a routing agent with the given model and sub-agents */
export function createRoutingAgent(modelId: MastraAgentConfig['model'], subAgents: Record<string, Agent>): Agent {
    const ollama = getOllamaProvider();
    const usingOllama = !!ollama;

    // Embedder: use Ollama embeddings when available, otherwise OpenRouter
    const embedder = usingOllama
        ? ollama.textEmbeddingModel(getOllamaModelName())
        : openrouter.textEmbeddingModel(MEMORY.EMBEDDER_MODEL);

    // Security processors require OpenRouter's guard model — skip when using Ollama
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputProcessors: any[] = [
        new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outputProcessors: any[] = [new TruncateToolResultsProcessor()];

    if (!usingOllama) {
        // Lazy-import to avoid breaking when OpenRouter key is absent
        const { PromptInjectionDetector, SystemPromptScrubber } = require('@mastra/core/processors');
        inputProcessors.push(
            new PromptInjectionDetector({
                model: GUARD_MODEL,
                threshold: 0.8,
                strategy: 'block',
                detectionTypes: ['injection', 'jailbreak', 'system-override'],
            }),
        );
        outputProcessors.unshift(
            new SystemPromptScrubber({
                model: GUARD_MODEL,
                strategy: 'redact',
                redactionMethod: 'remove',
            }),
        );
    }

    return new Agent({
        id: 'routingAgent',
        name: ROUTING_CONFIG.name,
        instructions: ROUTING_CONFIG.instructions,
        model: modelId,
        memory: new Memory({
            ...(vector && { vector }),
            embedder,
            options: {
                lastMessages: MEMORY.LAST_MESSAGES,
                semanticRecall: vector
                    ? {
                          topK: MEMORY.SEMANTIC_RECALL.TOP_K,
                          messageRange: MEMORY.SEMANTIC_RECALL.MESSAGE_RANGE,
                          scope: 'resource',
                      }
                    : false,
                generateTitle: MEMORY.GENERATE_TITLE,
            },
        }),
        agents: subAgents,
        tools: {
            ...ClientTools,
        },
        scorers: AGENT_SCORERS,
        inputProcessors,
        outputProcessors,
    });
}

/** Static default instance (backward compat) */
export const routingAgent = createRoutingAgent(getAgentModel(), { datagovAgent, cbsAgent });
