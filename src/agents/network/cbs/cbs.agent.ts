/**
 * CBS Agent
 *
 * Queries Israeli Central Bureau of Statistics — statistical series,
 * price indices, CPI calculations, and locality dictionary.
 */

import { Agent, type AgentConfig as MastraAgentConfig } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getAgentModel } from '../model';
import { CBS_AGENT_CONFIG } from './config';
import { AgentConfig } from '../../agent.config';
import { AGENT_SCORERS } from '../../evals/eval.config';
import { CbsTools } from '@/lib/tools/cbs';
import { EnsureTextOutputProcessor } from '../../processors/ensure-text-output.processor';
import { FailedToolCallGuardProcessor } from '../../processors/failed-tool-call-guard.processor';
import { TruncateToolResultsProcessor } from '../../processors/truncate-tool-results.processor';

const { MEMORY } = AgentConfig;

/** Factory: creates a CBS agent with the given model */
export function createCbsAgent(modelId: MastraAgentConfig['model']): Agent {
    return new Agent({
        id: 'cbsAgent',
        name: CBS_AGENT_CONFIG.name,
        description:
            'Queries Israeli Central Bureau of Statistics (CBS) — statistical price indices, CPI calculations, and locality dictionary.',
        instructions: CBS_AGENT_CONFIG.instructions,
        model: modelId,
        tools: CbsTools,
        inputProcessors: [new FailedToolCallGuardProcessor(), new EnsureTextOutputProcessor()],
        outputProcessors: [new TruncateToolResultsProcessor()],
        memory: new Memory({
            options: {
                lastMessages: MEMORY.LAST_MESSAGES,
            },
        }),
        scorers: AGENT_SCORERS,
    });
}

/** Static default instance (backward compat) */
export const cbsAgent = createCbsAgent(getAgentModel('cbs'));
