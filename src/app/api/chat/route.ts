/**
 * Chat API Route
 *
 * Streaming endpoint using Mastra agent network.
 * Utility functions are in src/lib/chat/.
 */

import { createUIMessageStreamResponse } from 'ai';
import { after, NextResponse } from 'next/server';
import { mastra } from '@/agents/mastra';
import { handleChatStream } from '@mastra/ai-sdk';
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui';
import { AppUIMessage } from '@/agents/types';
import { AgentConfig } from '@/agents/agent.config';
import { api, convexMutation } from '@/lib/convex/client';
import { clearActiveStreamId } from '@/lib/redis/resumable-stream';
import { sendPushToUser } from '@/lib/push/send-notification';
import { type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { type ZodError } from 'zod';

import { enrichWithSubAgentData } from '@/lib/chat/enrich-sub-agent-data';
import { deferTitleGeneration } from '@/lib/chat/defer-title-generation';
import { hasCompletedWithSuggestions } from '@/lib/chat/stop-conditions';
import { createUsageTracker, toConvexUsage } from '@/lib/chat/usage-tracker';
import { prepareChatContext } from '@/lib/chat/prepare-chat-context';
import { DELEGATION_FEEDBACK_TEXT } from '@/constants/chat';
import { filterChatHistoryMessages } from './filter-ui-messages';

const { CHAT } = AgentConfig;
const isDev = process.env.NODE_ENV === 'development';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getUserIdFromRequest(req: Request): string {
    return req.headers.get(CHAT.USER_ID_HEADER) || CHAT.DEFAULT_RESOURCE_ID;
}

// ─── GET /api/chat ──────────────────────────────────────────────────────────

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get('threadId');
    const resourceId = searchParams.get('resourceId') || getUserIdFromRequest(req);

    if (!threadId || !resourceId) {
        return NextResponse.json([]);
    }

    const memory = await mastra.getAgentById('routingAgent').getMemory();
    let response = null;

    try {
        response = await memory?.recall({ threadId, resourceId });
    } catch {
        // No previous messages found
    }

    const uiMessages = toAISdkV5Messages(response?.messages || []);

    if (memory) {
        try {
            await enrichWithSubAgentData(uiMessages, memory);
        } catch (e) {
            console.error('[chat GET] enrichWithSubAgentData failed:', e);
        }
    }

    return NextResponse.json(filterChatHistoryMessages(uiMessages));
}

// ─── POST /api/chat ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
    try {
        const params = await req.json();
        const { dynamicMastra, userId, threadId, userMessage, streamParams } = await prepareChatContext(req, params);
        const usage = createUsageTracker();

        const t0 = isDev ? performance.now() : 0;
        const stream = await handleChatStream<AppUIMessage>({
            version: 'v6',
            mastra: dynamicMastra,
            agentId: 'routingAgent',
            params: streamParams,
            defaultOptions: {
                providerOptions: {
                    google: {
                        thinkingConfig: { thinkingLevel: 'minimal' },
                    } satisfies GoogleGenerativeAIProviderOptions,
                },
                toolCallConcurrency: CHAT.TOOL_CALL_CONCURRENCY,
                delegation: {
                    onDelegationStart: async () => ({ modifiedMaxSteps: 15 }),
                    onDelegationComplete: async (context) => {
                        if (context.success && !context.result.text?.trim()) {
                            return { feedback: DELEGATION_FEEDBACK_TEXT };
                        }
                    },
                },
                stopWhen: hasCompletedWithSuggestions,
                onStepFinish: usage.onStepFinish,
                onFinish: ({ model }) => {
                    if (!threadId) return;
                    const modelId = model?.modelId ?? AgentConfig.MODEL.DEFAULT_ID;
                    const provider = model?.provider ?? 'openrouter';

                    const threadMeta = {
                        threadId,
                        userId,
                        agentName: 'routingAgent' as const,
                        model: modelId,
                        provider,
                    };
                    void convexMutation(api.threads.upsertThreadContext, {
                        ...threadMeta,
                        usage: toConvexUsage(usage.context),
                    });
                    void convexMutation(api.threads.upsertThreadBilling, {
                        ...threadMeta,
                        usage: toConvexUsage(usage.billing),
                    });

                    void clearActiveStreamId(threadId);

                    if (userMessage) {
                        // `after()` keeps the function alive until the task completes,
                        // so the title mutation actually runs on Vercel. A plain
                        // fire-and-forget promise gets dropped when the response closes.
                        after(async () => {
                            try {
                                await deferTitleGeneration(dynamicMastra, userMessage, threadId);
                            } catch (e) {
                                console.warn('[chat POST] deferred title generation failed:', e);
                            }
                        });
                    }

                    void sendPushToUser(userId, {
                        threadId,
                        title: 'התשובה מוכנה ✨',
                        body: 'התשובה לשאלתך מוכנה. לחץ כדי לצפות.',
                    });
                },
            },
            sendReasoning: true,
            sendSources: true,
        });

        if (isDev) {
            const t1 = performance.now();
            console.log(`[chat POST timing] handleChatStream=${(t1 - t0).toFixed(0)}ms`);
        }

        return createUIMessageStreamResponse({ stream });
    } catch (error) {
        // Zod validation errors return 400; everything else is 500
        if (error instanceof Error && error.name === 'ZodError') {
            return NextResponse.json(
                { error: 'Invalid request body', details: (error as ZodError).issues },
                { status: 400 },
            );
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error occurred' },
            { status: 500 },
        );
    }
}
