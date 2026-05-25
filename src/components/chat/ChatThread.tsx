'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, UIMessage } from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { useQuery as useConvexQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { AgentConfig } from '@/agents/agent.config';
import { threadService } from '@/services/thread.service';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { MessageItem } from '@/components/chat/MessageItem';
import { InputSection } from '@/components/chat/InputSection';
import { Suggestions } from './Suggestions';
import { extractSuggestions } from './extract-suggestions';
import { EmptyConversation } from './EmptyConversation';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { LoadingShimmer } from '@/components/chat/LoadingShimmer';
import { ContextWindowIndicator } from '@/components/chat/ContextWindowIndicator';
import { AIDevtools } from '@ai-sdk-tools/devtools';
import { useSessionStorage } from '@/hooks/use-session-storage';
import { INITIAL_MESSAGE_KEY, type InitialMessageData } from '@/constants/chat';
import { useUser } from '@/context/UserContext';
import { useSearchParams } from 'next/navigation';
import { usePushSubscription } from '@/hooks/use-push-subscription';
import { NotificationPrompt } from '@/components/chat/NotificationPrompt';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

/** Header name for passing user ID to API */
const USER_ID_HEADER = 'x-user-id';

interface ChatThreadProps {
    id: string;
}

export function ChatThread({ id }: ChatThreadProps) {
    const { userId: clerkUserId, isLoaded: isAuthLoaded } = useAuth();
    const { guestId } = useUser();
    const isMobile = useIsMobile();

    // Wait for auth to load before resolving userId — prevents storing
    // messages with guestId when the user is actually authenticated.
    const userId = isAuthLoaded ? (clerkUserId ?? guestId) : null;

    const contextWindow = useConvexQuery(api.threads.getThreadContextWindow, { threadId: id });
    const totalTokens = contextWindow?.totalTokens ?? 0;

    const searchParams = useSearchParams();
    const [initialMessageData, , removeInitialMessage] = useSessionStorage<InitialMessageData>(INITIAL_MESSAGE_KEY);
    const startedAsNew = useRef(initialMessageData?.chatId === id || searchParams.has('new'));

    // Use a ref so transport callbacks always read the latest userId
    // without recreating the transport on every auth state change.
    const userIdRef = useRef(userId);
    userIdRef.current = userId;

    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: '/api/chat',
                headers: () => ({
                    [USER_ID_HEADER]: userIdRef.current ?? 'anonymous',
                }),
                prepareSendMessagesRequest({ messages }) {
                    // Only send the last user message — server reconstructs
                    // full history from Convex memory. This prevents the
                    // request body from growing unboundedly with tool results.
                    const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1);
                    return {
                        body: {
                            id,
                            messages: lastUserMessage ? [lastUserMessage] : messages,
                            memory: {
                                thread: id,
                                resource: userIdRef.current,
                            },
                        },
                    };
                },
            }),
        [id],
    );

    const { messages, sendMessage, setMessages, status, regenerate, stop } = useChat({
        id,
        messages: [] as UIMessage[],
        transport,
        resume: !!process.env.NEXT_PUBLIC_UPSTASH_REDIS_REST_URL,
        onError: (error) => {
            console.error('[ChatThread] useChat error:', error.message);
            toast.error('חלה שגיאה. נסו שוב או פתחו שיחה חדשה.');
        },
    });

    const isNewConversation = startedAsNew.current && !messages.length;

    const { data: savedMessages, isFetching: isLoadingMessages } = useQuery({
        queryKey: ['threads', id, 'messages', userId],
        queryFn: () => threadService.getMessages(id, userId!),
        enabled: !startedAsNew.current && !!userId,
    });

    const didLoad = useRef(false);

    useEffect(() => {
        if (didLoad.current || !savedMessages?.length) return;
        didLoad.current = true;
        setMessages(savedMessages);
    }, [savedMessages, setMessages]);

    useEffect(() => {
        if (!initialMessageData || initialMessageData.chatId !== id || !isAuthLoaded) return;

        removeInitialMessage();
        void sendMessage({ text: initialMessageData.text });
    }, [id, initialMessageData, removeInitialMessage, sendMessage, isAuthLoaded]);

    const handleSend = useCallback(
        (text: string) => {
            if (!messages.length && startedAsNew.current) {
                window.history.replaceState(null, '', `/chat/${id}`);
            }
            void sendMessage({ text });
        },
        [messages.length, id, sendMessage],
    );

    const isStreaming = status === 'submitted' || status === 'streaming';
    const hasMessages = messages.length > 0;
    const isLoading = (!userId || isLoadingMessages) && !didLoad.current;

    const pushSubscription = usePushSubscription(userId);

    const lastAssistantMessage = messages.filter((m) => m.role === 'assistant').at(-1);
    const { suggestions: suggestionsFromTool, loading: suggestionsLoading } = useMemo(
        () => extractSuggestions(lastAssistantMessage),
        [lastAssistantMessage],
    );

    console.log({ messages });

    return (
        <div className='relative h-full w-full overflow-hidden'>
            <div className='mx-auto px-4 md:px-0 pb-4 md:pb-6 relative h-full w-full pt-14 md:pt-6'>
                <div className='flex flex-col gap-4 md:gap-6 h-full w-full items-center'>
                    {isLoading && !isNewConversation ? (
                        <div className='flex-1 w-full md:w-4xl mx-auto overflow-hidden'>
                            <MessageListSkeleton />
                        </div>
                    ) : isNewConversation ? (
                        <div className='relative flex-1 min-h-0 w-full md:w-4xl flex items-center justify-center'>
                            <EmptyConversation onClick={handleSend} />
                        </div>
                    ) : (
                        <Conversation className='w-full children-noscrollbar'>
                            <ConversationContent className='w-full md:w-4xl mx-auto'>
                                {messages.map((message, messageIndex) => (
                                    <MessageItem
                                        key={message.id}
                                        message={message}
                                        isLastMessage={messageIndex === messages.length - 1}
                                        isStreaming={isStreaming}
                                        onRegenerate={regenerate}
                                    />
                                ))}
                                {status === 'submitted' && <LoadingShimmer />}
                            </ConversationContent>
                            <ConversationScrollButton />
                        </Conversation>
                    )}

                    <div className='w-full md:w-4xl flex gap-1  flex-col'>
                        {!isStreaming && hasMessages && (suggestionsLoading || suggestionsFromTool) && (
                            <div className='relative z-20 w-full md:w-4xl'>
                                <Suggestions
                                    suggestions={suggestionsFromTool}
                                    loading={suggestionsLoading}
                                    onClick={handleSend}
                                />
                            </div>
                        )}
                        <InputSection
                            onSubmit={handleSend}
                            status={startedAsNew.current && !hasMessages ? undefined : status}
                            onStop={stop}
                        />
                        <NotificationPrompt
                            isSupported={pushSubscription.isSupported}
                            isSubscribed={pushSubscription.isSubscribed}
                            subscribe={pushSubscription.subscribe}
                            unsubscribe={pushSubscription.unsubscribe}
                            hasMessages={hasMessages}
                        />
                        {!!totalTokens && totalTokens > 0 && (
                            <ContextWindowIndicator
                                usedTokens={totalTokens}
                                maxTokens={AgentConfig.CHAT.MAX_CONTEXT_TOKENS}
                            />
                        )}
                    </div>
                </div>
            </div>

            {process.env.NODE_ENV === 'development' && !isMobile && (
                <AIDevtools
                    enabled
                    maxEvents={1000}
                    config={{
                        position: 'bottom',
                        height: 400,
                        streamCapture: {
                            enabled: true,
                            endpoint: '/api/chat',
                            autoConnect: true,
                        },
                    }}
                />
            )}
        </div>
    );
}
