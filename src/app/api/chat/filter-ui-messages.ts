import type { AppUIMessage } from '@/agents/types';
import { DELEGATION_FEEDBACK_TEXT } from '@/constants/chat';
import { getInternalToolNamePattern } from '@/data-sources/registry';

export function filterChatHistoryMessages(uiMessages: AppUIMessage[]): AppUIMessage[] {
    const toolNamePattern = getInternalToolNamePattern();

    for (const msg of uiMessages) {
        if (msg.role !== 'assistant') continue;
        for (const part of msg.parts) {
            if (part.type === 'text' && toolNamePattern.test(part.text)) {
                part.text = part.text
                    .split('\n')
                    .filter((line) => !toolNamePattern.test(line))
                    .join('\n')
                    .trim();
            }
        }
    }

    return uiMessages.filter((msg) => {
        if (msg.role !== 'assistant') return true;

        const textParts = msg.parts.filter((p) => p.type === 'text');
        const nonTextParts = msg.parts.filter((p) => p.type !== 'text');

        if (textParts.length === 0) return true;
        if (textParts.every((part) => !part.text.trim()) && nonTextParts.length === 0) return false;
        if (textParts.length !== 1 || nonTextParts.length > 0) return true;

        const text = textParts[0].text;
        return !text.includes(DELEGATION_FEEDBACK_TEXT) && !text.includes('הסוכן החזיר תוצאות כלים');
    });
}
