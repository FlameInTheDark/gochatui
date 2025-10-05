import type { DtoMessage } from '$lib/api';

function normalizeSnowflake(value: unknown): string | null {
        if (value == null) return null;
        try {
                if (typeof value === 'string') return value;
                if (typeof value === 'bigint') return value.toString();
                if (typeof value === 'number') return BigInt(value).toString();
                return String(value);
        } catch {
                try {
                        return String(value);
                } catch {
                        return null;
                }
        }
}

export interface MessageEventContext {
        event: any;
        currentMessages: DtoMessage[];
        selectedChannelId: string | null;
        wasAtBottom: boolean;
}

export interface MessageEventResult {
        messages: DtoMessage[];
        newCountDelta: number;
        shouldScrollToBottom: boolean;
}

export function applyMessageEventToList({
        event,
        currentMessages,
        selectedChannelId,
        wasAtBottom
}: MessageEventContext): MessageEventResult | null {
        if (!event || event.op !== 0) return null;

        const eventType = typeof event?.t === 'number' ? event.t : null;
        const payload = event?.d ?? {};

        if (payload?.message) {
                const incoming = payload.message as DtoMessage & { author_id?: unknown };
                const channelId = normalizeSnowflake((incoming as any)?.channel_id);
                const activeChannelId = normalizeSnowflake(selectedChannelId);
                if (!channelId || !activeChannelId || channelId !== activeChannelId) return null;

                if (!incoming.author && (incoming as any)?.author_id) {
                        (incoming as any).author = (incoming as any).author_id;
                }

                const incomingId = normalizeSnowflake((incoming as any)?.id);
                if (!incomingId) return null;

                const idx = currentMessages.findIndex(
                        (msg) => normalizeSnowflake((msg as any)?.id) === incomingId
                );

                if (idx >= 0) {
                        const nextMessages = [...currentMessages];
                        nextMessages[idx] = { ...nextMessages[idx], ...incoming };
                        return {
                                messages: nextMessages,
                                newCountDelta: 0,
                                shouldScrollToBottom: false
                        };
                }

                return {
                        messages: [...currentMessages, incoming],
                        newCountDelta: wasAtBottom ? 0 : 1,
                        shouldScrollToBottom: wasAtBottom
                };
        }

        if (payload?.message_id) {
                if (eventType === 300) return null;

                const messageId = normalizeSnowflake(payload.message_id);
                const channelId = normalizeSnowflake(payload.channel_id);
                const activeChannelId = normalizeSnowflake(selectedChannelId);
                if (!messageId || !channelId || !activeChannelId || channelId !== activeChannelId) return null;

                const filtered = currentMessages.filter(
                        (msg) => normalizeSnowflake((msg as any)?.id) !== messageId
                );

                if (filtered.length === currentMessages.length) return null;

                return {
                        messages: filtered,
                        newCountDelta: 0,
                        shouldScrollToBottom: false
                };
        }

        return null;
}
