import { derived, get, writable } from 'svelte/store';
import type { DtoChannel } from '$lib/api';
import { channelsByGuild } from '$lib/stores/appState';
import { guildChannelReadStateLookup, type GuildChannelReadStateLookup } from '$lib/stores/settings';
import { unreadSnapshot } from '$lib/stores/unreadSeed';

interface ChannelUnreadEntry {
        latestMessageId: string;
}

export type UnreadState = Record<string, Record<string, ChannelUnreadEntry>>;

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

const unreadChannelsInternal = writable<UnreadState>({});

let latestChannelsByGuild: Record<string, DtoChannel[]> = {};
let latestReadStateLookup: GuildChannelReadStateLookup | undefined;

export const unreadChannelsByGuild = derived(unreadChannelsInternal, ($unread) => {
        const result: UnreadState = {};
        for (const [guildId, channels] of Object.entries($unread)) {
                const entries = Object.entries(channels ?? {});
                if (!entries.length) continue;
                result[guildId] = Object.fromEntries(entries.map(([cid, entry]) => [cid, { ...entry }]));
        }
        return result;
});

export const guildUnreadSummary = derived(unreadChannelsInternal, ($unread) => {
        const summary: Record<string, { channelCount: number; channelIds: string[] }> = {};
        for (const [guildId, channels] of Object.entries($unread)) {
                const ids = Object.keys(channels ?? {});
                if (!ids.length) continue;
                summary[guildId] = {
                        channelCount: ids.length,
                        channelIds: ids
                };
        }
        return summary;
});

function updateState(
        updater: (state: UnreadState) => { next: UnreadState; changed: boolean }
): void {
        unreadChannelsInternal.update((state) => {
                const { next, changed } = updater(state);
                return changed ? next : state;
        });
}

export function markChannelUnread(guildId: unknown, channelId: unknown, messageId: unknown): void {
        const gid = normalizeId(guildId);
        const cid = normalizeId(channelId);
        const mid = normalizeId(messageId);
        if (!gid || !cid || !mid) return;
        const lookup = get(guildChannelReadStateLookup);
        const lastRead = lookup?.[gid]?.[cid]?.lastReadMessageId ?? null;
        if (!isMessageNewer(mid, lastRead)) return;
        updateState((state) => {
                const existingGuild = state[gid] ?? {};
                const currentEntry = existingGuild[cid];
                if (currentEntry && !isMessageNewer(mid, currentEntry.latestMessageId)) {
                        return { next: state, changed: false };
                }
                const nextGuild = { ...existingGuild, [cid]: { latestMessageId: mid } };
                const nextState = { ...state, [gid]: nextGuild };
                return { next: nextState, changed: true };
        });
}

export function clearChannelUnread(guildId: unknown, channelId: unknown): void {
        const gid = normalizeId(guildId);
        const cid = normalizeId(channelId);
        if (!gid || !cid) return;
        updateState((state) => {
                const existingGuild = state[gid];
                if (!existingGuild || !existingGuild[cid]) {
                        return { next: state, changed: false };
                }
                const { [cid]: _, ...restChannels } = existingGuild;
                const nextState = { ...state };
                if (Object.keys(restChannels).length) {
                        nextState[gid] = restChannels;
                } else {
                        delete nextState[gid];
                }
                return { next: nextState, changed: true };
        });
}

export function clearGuildUnread(guildId: unknown): void {
        const gid = normalizeId(guildId);
        if (!gid) return;
        updateState((state) => {
                if (!(gid in state)) {
                        return { next: state, changed: false };
                }
                const nextState = { ...state };
                delete nextState[gid];
                return { next: nextState, changed: true };
        });
}

export function acknowledgeChannelRead(
        guildId: unknown,
        channelId: unknown
): void {
        clearChannelUnread(guildId, channelId);
}

function clearChannelsWithoutUnreadEvidence() {
        if (!latestChannelsByGuild) return;
        for (const [guildId, channels] of Object.entries(latestChannelsByGuild)) {
                if (!guildId) continue;
                const readStates = latestReadStateLookup?.[guildId] ?? {};
                for (const channel of channels ?? []) {
                        if ((channel as any)?.type !== 0) continue;
                        const channelId = normalizeId((channel as any)?.id);
                        if (!channelId) continue;
                        const lastMessageId = normalizeId(
                                (channel as any)?.last_message_id ??
                                        (channel as any)?.lastMessageId ??
                                        (channel as any)?.lastMessage?.id ??
                                        (channel as any)?.last_message?.id ??
                                        (channel as any)?.lastMessage ??
                                        (channel as any)?.last_message
                        );
                        if (!lastMessageId) {
                                continue;
                        }
                        const lastRead = readStates?.[channelId]?.lastReadMessageId ?? null;
                        if (!isMessageNewer(lastMessageId, lastRead)) {
                                clearChannelUnread(guildId, channelId);
                        }
                }
        }
}

function buildUnreadStateFromSnapshot(snapshot: unknown): UnreadState {
        const readLookup = get(guildChannelReadStateLookup);
        const nextState: UnreadState = {};
        const visited = new Set<any>();

        const recordEntry = (guildId: string | null, channelId: string | null, messageId: string | null) => {
                if (!guildId || !channelId || !messageId) return;
                const lastRead = readLookup?.[guildId]?.[channelId]?.lastReadMessageId ?? null;
                if (!isMessageNewer(messageId, lastRead)) return;
                let guildState = nextState[guildId];
                if (!guildState) {
                        guildState = {};
                        nextState[guildId] = guildState;
                }
                const current = guildState[channelId];
                if (current && !isMessageNewer(messageId, current.latestMessageId)) return;
                guildState[channelId] = { latestMessageId: messageId };
        };

        const processChannelContainer = (guildId: string | null, payload: unknown) => {
                if (!guildId || payload == null) return;

                if (typeof payload === 'object') {
                        if (visited.has(payload)) return;
                        visited.add(payload);
                }

                if (Array.isArray(payload)) {
                        for (const entry of payload) {
                                if (Array.isArray(entry)) {
                                        const [channelKey, messageValue] = entry;
                                        recordEntry(guildId, normalizeId(channelKey), normalizeId(messageValue));
                                        continue;
                                }
                                if (entry && typeof entry === 'object') {
                                        const obj = entry as Record<string, unknown>;
                                        const channelId =
                                                normalizeId(
                                                        obj['channel_id'] ??
                                                                obj['channelId'] ??
                                                                (obj['channel'] as any)?.id ??
                                                                obj['id']
                                                ) ?? normalizeId(obj['channel']);
                                        const lastMessageId =
                                                normalizeId(
                                                        obj['last_message_id'] ??
                                                                obj['lastMessageId'] ??
                                                                obj['message_id'] ??
                                                                obj['last_message'] ??
                                                                obj['latest_message_id'] ??
                                                                obj['latestMessageId'] ??
                                                                obj['messageId'] ??
                                                                (Array.isArray(obj['value'])
                                                                        ? obj['value'][1]
                                                                        : (obj['value'] as unknown)) ??
                                                                obj['value'] ??
                                                                obj['last']
                                                );
                                        if (channelId && lastMessageId) {
                                                recordEntry(guildId, channelId, lastMessageId);
                                                continue;
                                        }
                                        processChannelContainer(guildId, entry);
                                        continue;
                                }
                                // entry might be an object map or primitive; ignore unsupported shapes
                        }
                        return;
                }

                if (typeof payload !== 'object' || payload == null) return;
                const obj = payload as Record<string, unknown>;

                const nestedArrays: Array<unknown> = [];
                const nestedObjects: Array<Record<string, unknown>> = [];

                for (const key of ['channels', 'channel_last_messages', 'channelLastMessages', 'channel_messages', 'items']) {
                        const value = obj[key];
                        if (!value) continue;
                        if (Array.isArray(value)) nestedArrays.push(value);
                        else if (typeof value === 'object') nestedObjects.push(value as Record<string, unknown>);
                }

                for (const arr of nestedArrays) {
                        processChannelContainer(guildId, arr);
                }
                for (const nested of nestedObjects) {
                        processChannelContainer(guildId, nested);
                }

                for (const [key, value] of Object.entries(obj)) {
                        if (
                                key === 'guild_id' ||
                                key === 'guildId' ||
                                key === 'channels' ||
                                key === 'channel_last_messages' ||
                                key === 'channelLastMessages' ||
                                key === 'channel_messages' ||
                                key === 'items'
                        ) {
                                continue;
                        }

                        const channelId =
                                normalizeId(
                                        (value as any)?.channel_id ??
                                                (value as any)?.channelId ??
                                                (value as any)?.channel?.id ??
                                                (Array.isArray(value) ? value[0] : undefined)
                                ) ?? normalizeId(key);
                        const lastMessageId =
                                normalizeId(
                                        (value as any)?.last_message_id ??
                                                (value as any)?.lastMessageId ??
                                                (value as any)?.message_id ??
                                                (value as any)?.last_message ??
                                                (value as any)?.latest_message_id ??
                                                (value as any)?.latestMessageId ??
                                                (Array.isArray(value) ? value[1] : value)
                                );
                        recordEntry(guildId, channelId, lastMessageId);
                }
        };

        const processSnapshot = (value: unknown) => {
                if (!value) return;
                if (Array.isArray(value)) {
                        for (const entry of value) {
                                if (entry == null) continue;
                                if (Array.isArray(entry)) {
                                        if (entry.length >= 3) {
                                                const [guildKey, channelKey, messageValue] = entry;
                                                recordEntry(
                                                        normalizeId(guildKey),
                                                        normalizeId(channelKey),
                                                        normalizeId(messageValue)
                                                );
                                        }
                                        continue;
                                }
                                if (typeof entry === 'object') {
                                        const obj = entry as Record<string, unknown>;
                                        const guildId =
                                                normalizeId(
                                                        obj['guild_id'] ??
                                                                obj['guildId'] ??
                                                                (obj['guild'] as any)?.id ??
                                                                (typeof obj['guild'] === 'string' ? obj['guild'] : undefined)
                                                );
                                        if (guildId) {
                                                processChannelContainer(guildId, obj);
                                        }
                                }
                        }
                        return;
                }

                if (typeof value !== 'object') return;
                const obj = value as Record<string, unknown>;
                if (Array.isArray(obj.guilds)) {
                        processSnapshot(obj.guilds);
                }
                for (const [key, payload] of Object.entries(obj)) {
                        const guildId = normalizeId(key);
                        if (guildId) {
                                processChannelContainer(guildId, payload);
                                continue;
                        }
                        if (key === 'guilds' || key === 'read_states') continue;
                        const derivedGuildId = normalizeId((payload as any)?.guild_id ?? (payload as any)?.guildId);
                        if (derivedGuildId) {
                                processChannelContainer(derivedGuildId, payload);
                        }
                }
        };

        processSnapshot(snapshot);

        return nextState;
}

function applyLastMessageSnapshot(snapshot: unknown) {
        if (snapshot == null) {
                unreadChannelsInternal.set({});
                clearChannelsWithoutUnreadEvidence();
                return;
        }
        const nextState = buildUnreadStateFromSnapshot(snapshot);
        unreadChannelsInternal.set(nextState);
        clearChannelsWithoutUnreadEvidence();
}

guildChannelReadStateLookup.subscribe((lookup) => {
        latestReadStateLookup = lookup;
        updateState((state) => {
                let changed = false;
                const nextState: UnreadState = {};
                for (const [guildId, channels] of Object.entries(state)) {
                        const guildReadStates = lookup?.[guildId] ?? {};
                        const nextGuild: Record<string, ChannelUnreadEntry> = {};
                        for (const [channelId, entry] of Object.entries(channels ?? {})) {
                                const lastRead = guildReadStates?.[channelId]?.lastReadMessageId ?? null;
                                if (isMessageNewer(entry.latestMessageId, lastRead)) {
                                        nextGuild[channelId] = entry;
                                } else {
                                        changed = true;
                                }
                        }
                        if (Object.keys(nextGuild).length) {
                                nextState[guildId] = nextGuild;
                        } else if (Object.keys(channels ?? {}).length) {
                                changed = true;
                        }
                }
                return { next: changed ? nextState : state, changed };
        });
        clearChannelsWithoutUnreadEvidence();
});

unreadSnapshot.subscribe((snapshot) => {
        applyLastMessageSnapshot(snapshot);
});

channelsByGuild.subscribe((map) => {
        latestChannelsByGuild = map ?? {};
        clearChannelsWithoutUnreadEvidence();
});
