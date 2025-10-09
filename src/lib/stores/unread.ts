import { derived, get, writable } from 'svelte/store';
import type { DtoChannel } from '$lib/api';
import { channelsByGuild, selectedChannelId, selectedGuildId } from '$lib/stores/appState';
import { guildChannelReadStateLookup, type GuildChannelReadStateLookup } from '$lib/stores/settings';

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

const MISSING_READ_STATE_PLACEHOLDER_ID = '0';

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

function markChannelsWithoutReadStates() {
        if (!latestChannelsByGuild) return;
        for (const [guildId, channels] of Object.entries(latestChannelsByGuild)) {
                if (!guildId) continue;
                const readStates = latestReadStateLookup?.[guildId] ?? {};
                for (const channel of channels ?? []) {
                        if ((channel as any)?.type !== 0) continue;
                        const channelId = normalizeId((channel as any)?.id);
                        if (!channelId) continue;
                        if (readStates?.[channelId]) continue;
                        markChannelUnread(guildId, channelId, MISSING_READ_STATE_PLACEHOLDER_ID);
                }
        }
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
        markChannelsWithoutReadStates();
});

selectedChannelId.subscribe((cid) => {
        const gid = get(selectedGuildId);
        if (gid && cid) {
                clearChannelUnread(gid, cid);
        }
});

selectedGuildId.subscribe((gid) => {
        const cid = get(selectedChannelId);
        if (gid && cid) {
                clearChannelUnread(gid, cid);
        }
});

channelsByGuild.subscribe((map) => {
        latestChannelsByGuild = map ?? {};
        markChannelsWithoutReadStates();
});
