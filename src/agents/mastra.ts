/**
 * Mastra Instance
 *
 * Central entry point registering all agents for the API route.
 * Uses ConvexStore as instance-level storage — all agents inherit it automatically.
 * Sentry observability is configured to trace agent runs, LLM calls, and tool executions.
 */

import { Mastra } from '@mastra/core';
import { ConvexStore } from '@mastra/convex';
import { Observability, SamplingStrategyType } from '@mastra/observability';
import { SentryExporter } from '@mastra/sentry';
import { cbsAgent, datagovAgent, routingAgent } from './network';
import { createRoutingAgent } from './network/routing/routing.agent';
import { createDatagovAgent } from './network/datagov/data-gov.agent';
import { createCbsAgent } from './network/cbs/cbs.agent';
import { MASTRA_SCORERS } from './evals/eval.config';
import { ENV } from '@/lib/env';
import { getOllamaProvider, getOllamaModelName } from './network/ollama';

const convexUrl = ENV.NEXT_PUBLIC_CONVEX_URL;
const convexAdminKey = ENV.CONVEX_ADMIN_KEY;

const storage =
    convexUrl && convexAdminKey
        ? new ConvexStore({
              id: 'convex-storage',
              deploymentUrl: convexUrl,
              adminAuthToken: convexAdminKey,
          })
        : undefined;

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

const observability = sentryDsn
    ? new Observability({
          configs: {
              sentry: {
                  serviceName: 'data-israel',
                  sampling: {
                      type: SamplingStrategyType.ALWAYS,
                  },
                  exporters: [
                      new SentryExporter({
                          dsn: sentryDsn,
                          environment: ENV.NODE_ENV,
                          tracesSampleRate: 1.0,
                      }),
                  ],
              },
          },
      })
    : undefined;

/** Static default agents (backward compat) */
export const agents = { routingAgent, cbsAgent, datagovAgent };

export const mastra = new Mastra({
    agents,
    ...(storage && { storage }),
    ...(observability && { observability }),
    scorers: MASTRA_SCORERS,
});

/** Per-agent model configuration (all values are OpenRouter model IDs like 'google/gemini-3-flash-preview') */
export interface AgentModelConfig {
    routing: string;
    datagov: string;
    cbs: string;
}

// Cache: single entry (last config -> last Mastra instance)
let cachedConfigKey: string | null = null;
let cachedMastra: Mastra | null = null;

/**
 * Creates (or returns cached) Mastra instance with the specified per-agent models.
 * Model IDs should be OpenRouter format (e.g., 'google/gemini-3-flash-preview').
 * When OLLAMA_BASE_URL is set, uses the Ollama provider for all agents.
 * Otherwise, prefixes model IDs with 'openrouter/' for Mastra's model format.
 */
export function getMastraWithModels(config: AgentModelConfig): Mastra {
    const ollama = getOllamaProvider();
    const configKey = JSON.stringify({ ...config, ollama: !!ollama });

    if (cachedConfigKey === configKey && cachedMastra) {
        return cachedMastra;
    }

    console.log({ config, usingOllama: !!ollama });

    const resolveModel = (modelId: string) => {
        if (ollama) return ollama(getOllamaModelName());
        if (process.env.ANTHROPIC_API_KEY && modelId.startsWith('claude-')) {
            return `anthropic/${modelId}`;
        }
        return `openrouter/${modelId}`;
    };

    const newDatagov = createDatagovAgent(resolveModel(config.datagov));
    const newCbs = createCbsAgent(resolveModel(config.cbs));
    const newRouting = createRoutingAgent(resolveModel(config.routing), {
        datagovAgent: newDatagov,
        cbsAgent: newCbs,
    });

    const newMastra = new Mastra({
        agents: { routingAgent: newRouting, cbsAgent: newCbs, datagovAgent: newDatagov },
        ...(storage && { storage }),
        ...(observability && { observability }),
        scorers: MASTRA_SCORERS,
    });

    cachedConfigKey = configKey;
    cachedMastra = newMastra;

    return newMastra;
}
