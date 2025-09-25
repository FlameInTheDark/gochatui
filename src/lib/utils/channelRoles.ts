import { get } from 'svelte/store';
import type { DtoChannel, GuildChannelRolePermission } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { channelRolesByGuild } from '$lib/stores/appState';

function toSnowflakeString(value: unknown): string | null {
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

function toApiSnowflake(value: string): any {
        try {
                return BigInt(value) as any;
        } catch {
                return value as any;
        }
}

const cache = new Map<string, Map<string, string[]>>();
const inflight = new Map<string, Map<string, Promise<string[]>>>();

function setCacheEntry(guildId: string, channelId: string, roleIds: string[]) {
        let guildCache = cache.get(guildId);
        if (!guildCache) {
                guildCache = new Map<string, string[]>();
                cache.set(guildId, guildCache);
        }
        guildCache.set(channelId, roleIds);
        channelRolesByGuild.update((map) => {
                const nextGuild = { ...(map[guildId] ?? {}) };
                nextGuild[channelId] = roleIds;
                return { ...map, [guildId]: nextGuild };
        });
}

function deleteCacheEntry(guildId: string, channelId: string) {
        const guildCache = cache.get(guildId);
        if (guildCache) {
                guildCache.delete(channelId);
                if (guildCache.size === 0) {
                        cache.delete(guildId);
                }
        }
        channelRolesByGuild.update((map) => {
                const existing = map[guildId];
                if (!existing || !Object.prototype.hasOwnProperty.call(existing, channelId)) {
                        return map;
                }
                const { [channelId]: _removed, ...rest } = existing;
                return { ...map, [guildId]: rest };
        });
}

export function getCachedChannelRoleIds(
        guildId: string | number | bigint,
        channelId: string | number | bigint
): string[] | undefined {
        const gid = toSnowflakeString(guildId);
        const cid = toSnowflakeString(channelId);
        if (!gid || !cid) return undefined;
        const guildCache = cache.get(gid);
        if (guildCache && guildCache.has(cid)) {
                return guildCache.get(cid);
        }
        const store = get(channelRolesByGuild);
        const stored = store[gid]?.[cid];
        if (stored) {
                setCacheEntry(gid, cid, stored);
                return stored;
        }
        return undefined;
}

async function fetchChannelRoleIds(guildId: string, channelId: string): Promise<string[]> {
        const response = await auth.api.guildRoles.guildGuildIdChannelChannelIdRolesGet({
                guildId: toApiSnowflake(guildId),
                channelId: toApiSnowflake(channelId)
        });
        const list = ((response as any)?.data ?? response ?? []) as GuildChannelRolePermission[];
        const ids: string[] = [];
        for (const entry of list) {
                const rid = toSnowflakeString(entry?.role_id);
                if (rid) ids.push(rid);
        }
        setCacheEntry(guildId, channelId, ids);
        return ids;
}

export async function loadChannelRoleIds(
        guildId: string | number | bigint,
        channelId: string | number | bigint
): Promise<string[]> {
        const gid = toSnowflakeString(guildId);
        const cid = toSnowflakeString(channelId);
        if (!gid || !cid) return [];
        const cached = getCachedChannelRoleIds(gid, cid);
        if (cached) return cached;
        let guildInflight = inflight.get(gid);
        if (!guildInflight) {
            guildInflight = new Map<string, Promise<string[]>>();
            inflight.set(gid, guildInflight);
        }
        const existing = guildInflight.get(cid);
        if (existing) return existing;
        const pending = fetchChannelRoleIds(gid, cid)
                .catch((err) => {
                        deleteCacheEntry(gid, cid);
                        throw err;
                })
                .finally(() => {
                        const current = inflight.get(gid);
                        current?.delete(cid);
                        if (current && current.size === 0) {
                                inflight.delete(gid);
                        }
                });
        guildInflight.set(cid, pending);
        return pending;
}

export async function refreshChannelRoleIds(
        guildId: string | number | bigint,
        channelId: string | number | bigint
): Promise<string[]> {
        const gid = toSnowflakeString(guildId);
        const cid = toSnowflakeString(channelId);
        if (!gid || !cid) return [];
        deleteCacheEntry(gid, cid);
        return loadChannelRoleIds(gid, cid);
}

export function invalidateChannelRoleIds(
        guildId: string | number | bigint,
        channelId?: string | number | bigint
) {
        const gid = toSnowflakeString(guildId);
        if (!gid) return;
        if (channelId == null) {
                cache.delete(gid);
                inflight.delete(gid);
                channelRolesByGuild.update((map) => {
                        if (!Object.prototype.hasOwnProperty.call(map, gid)) return map;
                        const { [gid]: _removed, ...rest } = map;
                        return rest;
                });
                return;
        }
        const cid = toSnowflakeString(channelId);
        if (!cid) return;
        deleteCacheEntry(gid, cid);
        const guildInflight = inflight.get(gid);
        guildInflight?.delete(cid);
        if (guildInflight && guildInflight.size === 0) {
                inflight.delete(gid);
        }
}

export function pruneChannelRoleCache(
        guildId: string | number | bigint,
        channels: Iterable<DtoChannel | string | number | bigint>
) {
        const gid = toSnowflakeString(guildId);
        if (!gid) return;
        const keep = new Set<string>();
        for (const entry of channels) {
                const id =
                        typeof entry === 'object' && entry !== null
                                ? toSnowflakeString((entry as any)?.id ?? (entry as any)?.channel_id)
                                : toSnowflakeString(entry);
                if (id) keep.add(id);
        }
        if (!keep.size) {
                invalidateChannelRoleIds(gid);
                return;
        }
        const guildCache = cache.get(gid);
        if (guildCache) {
                for (const key of Array.from(guildCache.keys())) {
                        if (!keep.has(key)) {
                                guildCache.delete(key);
                        }
                }
                if (guildCache.size === 0) {
                        cache.delete(gid);
                }
        }
        channelRolesByGuild.update((map) => {
                const existing = map[gid];
                if (!existing) return map;
                const next: Record<string, string[]> = {};
                for (const [key, value] of Object.entries(existing)) {
                        if (keep.has(key)) {
                                next[key] = value;
                        }
                }
                return { ...map, [gid]: next };
        });
}

export async function primeGuildChannelRoles(
        guildId: string | number | bigint,
        channels: Iterable<DtoChannel>
): Promise<void> {
        const gid = toSnowflakeString(guildId);
        if (!gid) return;
        const tasks: Promise<unknown>[] = [];
        for (const channel of channels) {
                const channelId = toSnowflakeString((channel as any)?.id);
                if (!channelId) continue;
                const type = (channel as any)?.type ?? 0;
                if (type === 2) continue;
                const isPrivate = Boolean((channel as any)?.private);
                if (!isPrivate) {
                        invalidateChannelRoleIds(gid, channelId);
                        continue;
                }
                if (getCachedChannelRoleIds(gid, channelId) !== undefined) continue;
                tasks.push(
                        loadChannelRoleIds(gid, channelId).catch(() => {
                                /* ignore individual failures */
                        })
                );
        }
        if (tasks.length) {
                await Promise.all(tasks);
        }
}
