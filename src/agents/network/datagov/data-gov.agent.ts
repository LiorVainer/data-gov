/**
 * DataGov Search Agent
 *
 * Searches and explores Israeli open datasets from data.gov.il
 */

import { Agent, type AgentConfig as MastraAgentConfig } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getAgentModel } from '../model';
import { DATAGOV_AGENT_CONFIG } from './config';
import { AgentConfig } from '../../agent.config';
import { AGENT_SCORERS } from '../../evals/eval.config';
import { DataGovTools } from '@/lib/tools/datagov';
import { EnsureTextOutputProcessor } from '../../processors/ensure-text-output.processor';
import { FailedToolCallGuardProcessor } from '../../processors/failed-tool-call-guard.processor';
import { TruncateToolResultsProcessor } from '../../processors/truncate-tool-results.processor';

const { MEMORY } = AgentConfig;

/** Factory: creates a DataGov agent with the given model */
export function createDatagovAgent(modelId: MastraAgentConfig['model']): Agent {
    return new Agent({
        id: 'datagovAgent',
        name: DATAGOV_AGENT_CONFIG.name,
        description:
            'Searches and explores Israeli open datasets from data.gov.il — datasets, organizations, groups, tags, resources, and DataStore queries.',
        instructions: DATAGOV_AGENT_CONFIG.instructions,
        model: modelId,
        tools: DataGovTools,
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
export const datagovAgent = createDatagovAgent(getAgentModel('datagov'));
