import { derived, get, writable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { mentionSnapshot } from '$lib/stores/mentionSeed';
import { guildChannelReadStateLookup } from '$lib/stores/settings';
import { channelsByGuild } from '$lib/stores/appState';

interface MentionEntry {
        messageId: string;
        type: number | null;
}

interface ChannelMentionState {
        channelId: string;
        guildId: string | null;
        messages: MentionEntry[];
        latestMessageId: string | null;
}

export type MentionState = Record<string, ChannelMentionState>;

interface ChannelMentionSummary {
        count: number;
        latestMessageId: string | null;
}

export type ChannelMentionSummaryByGuild = Record<string, Record<string, ChannelMentionSummary>>;

export type GuildMentionSummary = Record<string, { mentionCount: number; channelIds: string[] }>;

type AnyRecord = Record<string, unknown>;

const mentionsInternal = writable<MentionState>({});

function cloneState(state: MentionState): MentionState {
        const next: MentionState = {};
        for (const [channelId, entry] of Object.entries(state)) {
                next[channelId] = {
                        channelId: entry.channelId,
                        guildId: entry.guildId,
                        latestMessageId: entry.latestMessageId,
                        messages: entry.messages.map((message) => ({ ...message }))
                };
        }
        return next;
}

function normalizeId(value: unknown): string | null {
        if (value == null) return null;
        try {
                if (typeof value === 'string') return value;
                if (typeof value === 'number' || typeof value === 'bigint') return BigInt(value).toString();
                return String(value);
        } catch {
                try {
                        return String(value);
                } catch {
                        return null;
                }
        }
}

function compareSnowflakes(a: string | null, b: string | null): number {
        if (a === b) return 0;
        if (a == null) return b == null ? 0 : -1;
        if (b == null) return 1;
        const digitsA = /^\d+$/.test(a);
        const digitsB = /^\d+$/.test(b);
        if (digitsA && digitsB) {
                try {
                        const ai = BigInt(a);
                        const bi = BigInt(b);
                        if (ai === bi) return 0;
                        return ai < bi ? -1 : 1;
                } catch {
                        /* fall through */
                }
        }
        if (a.length !== b.length) return a.length < b.length ? -1 : 1;
        return a.localeCompare(b);
}

function isMessageNewer(messageId: string | null, lastRead: string | null): boolean {
        if (!messageId) return false;
        if (!lastRead) return true;
        return compareSnowflakes(messageId, lastRead) > 0;
}

function extractId(payload: AnyRecord, ...keys: string[]): string | null {
        for (const key of keys) {
                if (key in payload) {
                        return normalizeId(payload[key]);
                }
        }
        return null;
}

function dedupeAndSort(entries: MentionEntry[]): MentionEntry[] {
        const seen = new Set<string>();
        const filtered = entries.filter((entry) => {
                if (seen.has(entry.messageId)) return false;
                seen.add(entry.messageId);
                return true;
        });
        filtered.sort((a, b) => compareSnowflakes(a.messageId, b.messageId));
        return filtered;
}

function buildStateFromSnapshot(): void {
        const snapshot = get(mentionSnapshot);
        const readLookup = get(guildChannelReadStateLookup);
        if (!snapshot) {
                mentionsInternal.set({});
                return;
        }

        const channelGuildLookup = snapshot.channelGuildLookup ?? {};
        const accumulator = new Map<string, ChannelMentionState>();

        const addMention = (
                guildIdRaw: unknown,
                channelIdRaw: unknown,
                messageIdRaw: unknown,
                typeRaw: unknown
        ) => {
                const channelId = normalizeId(channelIdRaw);
                const messageId = normalizeId(messageIdRaw);
                if (!channelId || !messageId) return;
                const explicitGuildId = normalizeId(guildIdRaw) ?? null;
                const inferredGuildId = channelGuildLookup[channelId] ?? null;
                const guildId = explicitGuildId ?? inferredGuildId ?? '@me';
                const lastRead = readLookup?.[guildId]?.[channelId]?.lastReadMessageId ?? null;
                if (!isMessageNewer(messageId, lastRead)) return;
                const type = typeof typeRaw === 'number' && Number.isInteger(typeRaw) ? typeRaw : null;
                const existing = accumulator.get(channelId);
                const messages = existing ? [...existing.messages, { messageId, type }] : [{ messageId, type }];
                const deduped = dedupeAndSort(messages);
                accumulator.set(channelId, {
                        channelId,
                        guildId: existing?.guildId ?? explicitGuildId ?? inferredGuildId ?? '@me',
                        messages: deduped,
                        latestMessageId: deduped[deduped.length - 1]?.messageId ?? null
                });
        };

        const rawMentions = snapshot.mentions as AnyRecord | null;
        if (rawMentions && typeof rawMentions === 'object') {
                for (const [channelKey, entries] of Object.entries(rawMentions)) {
                        const channelId = normalizeId(channelKey);
                        if (!channelId || !Array.isArray(entries)) continue;
                        for (const entry of entries as AnyRecord[]) {
                                const messageId = extractId(entry, 'MessageId', 'message_id', 'messageId', 'id');
                                if (!messageId) continue;
                                addMention(
                                        extractId(entry, 'GuildId', 'guild_id', 'guildId'),
                                        channelId,
                                        messageId,
                                        null
                                );
                        }
                }
        }

        const rawChannelMentions = snapshot.channelMentions as AnyRecord | null;
        if (rawChannelMentions && typeof rawChannelMentions === 'object') {
                for (const [channelKey, entries] of Object.entries(rawChannelMentions)) {
                        const channelId = normalizeId(channelKey);
                        if (!channelId || !Array.isArray(entries)) continue;
                        for (const entry of entries as AnyRecord[]) {
                                const messageId = extractId(entry, 'MessageId', 'message_id', 'messageId', 'id');
                                if (!messageId) continue;
                                const guildId = extractId(entry, 'GuildId', 'guild_id', 'guildId');
                                const type = entry?.type ?? entry?.Type ?? null;
                                addMention(guildId, channelId, messageId, type);
                        }
                }
        }

        const next: MentionState = {};
        for (const [channelId, entry] of accumulator.entries()) {
                next[channelId] = entry;
        }
        mentionsInternal.set(next);
}

mentionSnapshot.subscribe(() => {
        buildStateFromSnapshot();
});

guildChannelReadStateLookup.subscribe((lookup) => {
        mentionsInternal.update((state) => {
                let changed = false;
                const next: MentionState = {};
                for (const [channelId, entry] of Object.entries(state)) {
                        const guildId = entry.guildId ?? '@me';
                        const lastRead = lookup?.[guildId]?.[channelId]?.lastReadMessageId ?? null;
                        if (!entry.messages.length) {
                                continue;
                        }
                        const filtered = entry.messages.filter((message) => isMessageNewer(message.messageId, lastRead));
                        if (!filtered.length) {
                                changed = true;
                                continue;
                        }
                        if (filtered.length !== entry.messages.length) {
                                changed = true;
                                next[channelId] = {
                                        channelId,
                                        guildId,
                                        messages: filtered,
                                        latestMessageId: filtered[filtered.length - 1]?.messageId ?? null
                                };
                                continue;
                        }
                        const latestMessageId = filtered[filtered.length - 1]?.messageId ?? null;
                        if (latestMessageId !== entry.latestMessageId || entry.guildId == null) {
                                changed = true;
                                next[channelId] = {
                                        channelId,
                                        guildId,
                                        messages: filtered,
                                        latestMessageId
                                };
                                continue;
                        }
                        next[channelId] = entry;
                }
                return changed ? next : state;
        });
});

function resolveGuildLookup(channels: Record<string, any[]>): Record<string, string> {
        const lookup: Record<string, string> = {};
        for (const [guildId, list] of Object.entries(channels ?? {})) {
                        for (const channel of list ?? []) {
                                const channelId = normalizeId((channel as AnyRecord)?.id);
                                if (!channelId) continue;
                                if (!(channelId in lookup)) {
                                        lookup[channelId] = guildId;
                                }
                        }
        }
        return lookup;
}

export const channelMentionsByGuild: Readable<ChannelMentionSummaryByGuild> = derived(
        [mentionsInternal, channelsByGuild],
        ([$mentions, $channels]) => {
                const result: ChannelMentionSummaryByGuild = {};
                const guildLookup = resolveGuildLookup($channels as Record<string, any[]>);
                for (const [channelId, entry] of Object.entries($mentions)) {
                        const count = entry.messages.length;
                        if (!count) continue;
                        const guildId = entry.guildId ?? guildLookup[channelId] ?? '@me';
                        if (!result[guildId]) {
                                result[guildId] = {};
                        }
                        result[guildId]![channelId] = {
                                count,
                                latestMessageId: entry.latestMessageId
                        };
                }
                return result;
        }
);

export const guildMentionSummary: Readable<GuildMentionSummary> = derived(
        channelMentionsByGuild,
        ($mentions) => {
                const summary: GuildMentionSummary = {};
                for (const [guildId, channels] of Object.entries($mentions)) {
                        const channelIds = Object.keys(channels ?? {});
                        if (!channelIds.length) continue;
                        const mentionCount = channelIds.reduce(
                                (total, channelId) => total + (channels[channelId]?.count ?? 0),
                                0
                        );
                        if (mentionCount <= 0) continue;
                        summary[guildId] = { mentionCount, channelIds };
                }
                return summary;
        }
);

export function recordChannelMention(
        guildId: unknown,
        channelId: unknown,
        messageId: unknown,
        type: unknown
): void {
        const channel = normalizeId(channelId);
        const message = normalizeId(messageId);
        if (!channel || !message) return;
        const resolvedGuildId = normalizeId(guildId) ?? '@me';
        const readLookup = get(guildChannelReadStateLookup);
        const lastRead = readLookup?.[resolvedGuildId]?.[channel]?.lastReadMessageId ?? null;
        if (!isMessageNewer(message, lastRead)) return;
        const typeValue = typeof type === 'number' && Number.isInteger(type) ? type : null;
        mentionsInternal.update((state) => {
                const existing = state[channel];
                const messages = existing ? [...existing.messages, { messageId: message, type: typeValue }] : [{ messageId: message, type: typeValue }];
                const deduped = dedupeAndSort(messages);
                if (existing && deduped.length === existing.messages.length) {
                        if (existing.guildId == null && resolvedGuildId) {
                                return {
                                        ...state,
                                        [channel]: {
                                                ...existing,
                                                guildId: resolvedGuildId
                                        }
                                } satisfies MentionState;
                        }
                        return state;
                }
                return {
                        ...state,
                        [channel]: {
                                channelId: channel,
                                guildId: existing?.guildId ?? resolvedGuildId,
                                messages: deduped,
                                latestMessageId: deduped[deduped.length - 1]?.messageId ?? null
                        }
                } satisfies MentionState;
        });
}

export function clearChannelMentions(
        guildId: unknown,
        channelId: unknown,
        upToMessageId: unknown = null
): void {
        const channel = normalizeId(channelId);
        if (!channel) return;
        const resolvedGuildId = normalizeId(guildId) ?? '@me';
        const cutoff = normalizeId(upToMessageId);
        mentionsInternal.update((state) => {
                const existing = state[channel];
                if (!existing) return state;
                const messages = cutoff
                        ? existing.messages.filter((message) => isMessageNewer(message.messageId, cutoff))
                        : [];
                if (!messages.length) {
                        const { [channel]: _removed, ...rest } = state;
                        return rest;
                }
                if (messages.length === existing.messages.length && existing.guildId) {
                        return state;
                }
                return {
                        ...state,
                        [channel]: {
                                channelId: channel,
                                guildId: existing.guildId ?? resolvedGuildId,
                                messages,
                                latestMessageId: messages[messages.length - 1]?.messageId ?? null
                        }
                } satisfies MentionState;
        });
}

export function clearGuildMentions(guildId: unknown): void {
        const resolvedGuildId = normalizeId(guildId) ?? '@me';
        mentionsInternal.update((state) => {
                let changed = false;
                const next: MentionState = {};
                for (const [channelId, entry] of Object.entries(state)) {
                        const guildIdForChannel = entry.guildId ?? '@me';
                        if (guildIdForChannel === resolvedGuildId) {
                                changed = true;
                                continue;
                        }
                        next[channelId] = entry;
                }
                return changed ? next : state;
        });
}

export function resetMentionState(): void {
        mentionsInternal.set({});
}

export const mentionsState: Readable<MentionState> = derived(mentionsInternal, ($mentions) =>
        cloneState($mentions)
);
