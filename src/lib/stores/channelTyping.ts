import { derived, writable } from 'svelte/store';
import { toSnowflakeString } from '$lib/utils/members';

const DEFAULT_DURATION_MS = 10_000;

type ChannelTypingState = Record<string, Record<string, number>>;

const typingState = writable<ChannelTypingState>({});

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const suppressionExpirations = new Map<string, number>();
const MESSAGE_SUPPRESSION_MS = 1_500;

function makeKey(channelId: string, userId: string): string {
        return `${channelId}:${userId}`;
}

function scheduleExpiry(channelId: string, userId: string, durationMs: number) {
        const key = makeKey(channelId, userId);
        const existing = timers.get(key);
        if (existing) {
                clearTimeout(existing);
        }
        timers.set(
                key,
                setTimeout(() => {
                        timers.delete(key);
                        suppressionExpirations.delete(key);
                        typingState.update((state) => {
                                const channelEntry = state[channelId];
                                if (!channelEntry || channelEntry[userId] == null) {
                                        return state;
                                }
                                const nextChannelEntry = { ...channelEntry };
                                delete nextChannelEntry[userId];
                                const nextState = { ...state };
                                if (Object.keys(nextChannelEntry).length > 0) {
                                        nextState[channelId] = nextChannelEntry;
                                } else {
                                        delete nextState[channelId];
                                }
                                return nextState;
                        });
                }, durationMs)
        );
}

function clearTimer(channelId: string, userId: string) {
        const key = makeKey(channelId, userId);
        const existing = timers.get(key);
        if (existing) {
                clearTimeout(existing);
                timers.delete(key);
        }
}

function shouldSuppressTyping(channelId: string, userId: string): boolean {
        const key = makeKey(channelId, userId);
        const expiry = suppressionExpirations.get(key);
        if (!expiry) {
                return false;
        }
        if (expiry > Date.now()) {
                return true;
        }
        suppressionExpirations.delete(key);
        return false;
}

export function markChannelTyping(
        rawChannelId: unknown,
        rawUserId: unknown,
        options?: { durationMs?: number }
): void {
        const channelId = toSnowflakeString(rawChannelId);
        const userId = toSnowflakeString(rawUserId);
        if (!channelId || !userId) return;
        const durationMs = Math.max(0, options?.durationMs ?? DEFAULT_DURATION_MS);

        if (shouldSuppressTyping(channelId, userId)) {
                return;
        }

        typingState.update((state) => {
                const next = { ...state };
                const channelEntry = { ...(next[channelId] ?? {}) };
                channelEntry[userId] = Date.now() + durationMs;
                next[channelId] = channelEntry;
                return next;
        });

        scheduleExpiry(channelId, userId, durationMs);
}

export function clearChannelTyping(rawChannelId: unknown, rawUserId: unknown): void {
        const channelId = toSnowflakeString(rawChannelId);
        const userId = toSnowflakeString(rawUserId);
        if (!channelId || !userId) return;
        clearTimer(channelId, userId);
        suppressionExpirations.set(makeKey(channelId, userId), Date.now() + MESSAGE_SUPPRESSION_MS);
        typingState.update((state) => {
                const channelEntry = state[channelId];
                if (!channelEntry || channelEntry[userId] == null) {
                        return state;
                }
                const nextChannelEntry = { ...channelEntry };
                delete nextChannelEntry[userId];
                const nextState = { ...state };
                if (Object.keys(nextChannelEntry).length > 0) {
                        nextState[channelId] = nextChannelEntry;
                } else {
                        delete nextState[channelId];
                }
                return nextState;
        });
}

export const channelTypingUsers = derived(typingState, ($state) => {
        const lookup: Record<string, string[]> = {};
        for (const [channelId, users] of Object.entries($state)) {
                lookup[channelId] = Object.keys(users);
        }
        return lookup;
});
