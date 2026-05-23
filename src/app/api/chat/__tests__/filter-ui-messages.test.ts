import { describe, expect, it } from 'vitest';
import { filterChatHistoryMessages } from '../filter-ui-messages';
import type { AppUIMessage } from '@/agents/types';

describe('filterChatHistoryMessages', () => {
    it('removes assistant messages that become empty after stripping internal tool-name lines', () => {
        const messages = [
            {
                id: '1',
                role: 'assistant',
                parts: [{ type: 'text', text: 'קרא ל-suggestFollowUps' }],
            },
            {
                id: '2',
                role: 'assistant',
                parts: [{ type: 'text', text: 'תשובה תקינה למשתמש' }],
            },
        ] as AppUIMessage[];

        const filtered = filterChatHistoryMessages(messages);

        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.id).toBe('2');
    });

    it('preserves tool-only assistant messages even when their text summary is stripped', () => {
        const messages = [
            {
                id: '1',
                role: 'assistant',
                parts: [
                    { type: 'text', text: 'קרא ל-suggestFollowUps' },
                    { type: 'tool-suggestFollowUps', state: 'output-available', input: {}, output: {} },
                ],
            },
        ] as AppUIMessage[];

        const filtered = filterChatHistoryMessages(messages);

        expect(filtered).toHaveLength(1);
        const textPart = filtered[0]?.parts.find((part) => part.type === 'text');
        expect(textPart && 'text' in textPart ? textPart.text : undefined).toBe('');
    });
});
