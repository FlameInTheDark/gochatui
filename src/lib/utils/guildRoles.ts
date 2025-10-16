import { get, writable } from 'svelte/store';
import type { DtoChannel, DtoRole, GuildChannelRolePermission } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { channelRolesByGuild } from '$lib/stores/appState';
import { normalizeChannelRoleIds } from '$lib/utils/channelRoles';

const guildRolesResolved = new Map<string, DtoRole[]>();
const guildRolesInFlight = new Map<string, Promise<DtoRole[]>>();
const roleIdToGuildId = new Map<string, string>();
const guildIdToRoleIds = new Map<string, Set<string>>();
const channelRoleCache = new Map<string, Map<string, string[]>>();
const channelRoleInflight = new Map<string, Map<string, Promise<string[]>>>();

const guildRoleCacheRevision = writable(0);

export const guildRoleCacheState = {
	subscribe: guildRoleCacheRevision.subscribe
};

function bumpGuildRoleCacheRevision() {
	guildRoleCacheRevision.update((value) => value + 1);
}

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

function trackRoleMapping(guildId: string, roles: DtoRole[]) {
	const key = String(guildId);
	if (!key) return;
	const previous = guildIdToRoleIds.get(key);
	if (previous) {
		for (const roleId of previous) {
			roleIdToGuildId.delete(roleId);
		}
	}
	const ids = new Set<string>();
	for (const role of roles) {
		const raw = (role as any)?.id;
		const roleId = toSnowflakeString(raw);
		if (!roleId) continue;
		ids.add(roleId);
		roleIdToGuildId.set(roleId, key);
	}
	guildIdToRoleIds.set(key, ids);
}

function forgetGuildRoleMapping(guildId: string) {
	const key = String(guildId);
	if (!key) return;
	const previous = guildIdToRoleIds.get(key);
	if (previous) {
		for (const roleId of previous) {
			roleIdToGuildId.delete(roleId);
		}
	}
	guildIdToRoleIds.delete(key);
}

export function rememberRoleGuild(
	roleId: string | null | undefined,
	guildId: string | null | undefined
) {
	const rid = toSnowflakeString(roleId);
	const gid = toSnowflakeString(guildId);
	if (!rid || !gid) return;
	roleIdToGuildId.set(rid, gid);
	let set = guildIdToRoleIds.get(gid);
	if (!set) {
		set = new Set<string>();
		guildIdToRoleIds.set(gid, set);
	}
	set.add(rid);
}

export function getGuildIdForRole(roleId: string | null | undefined): string | null {
	const rid = toSnowflakeString(roleId);
	if (!rid) return null;
	return roleIdToGuildId.get(rid) ?? null;
}

function toApiSnowflake(value: string): any {
	try {
		return BigInt(value) as any;
	} catch {
		return value as any;
	}
}

export async function loadGuildRolesCached(guildId: string): Promise<DtoRole[]> {
	const key = String(guildId);
	if (!key || key === '@me') return [];

	const cached = guildRolesResolved.get(key);
	if (cached) return cached;

	let pending = guildRolesInFlight.get(key);
	if (!pending) {
		pending = auth.api.guildRoles
			.guildGuildIdRolesGet({ guildId: toApiSnowflake(key) })
			.then((res) => {
				const list = ((res as any)?.data ?? res ?? []) as DtoRole[];
				guildRolesResolved.set(key, list);
				trackRoleMapping(key, list);
				guildRolesInFlight.delete(key);
				return list;
			})
			.catch((err) => {
				guildRolesInFlight.delete(key);
				throw err;
			});
		guildRolesInFlight.set(key, pending);
	}

	return pending;
}

export function invalidateGuildRolesCache(guildId?: string) {
	if (!guildId) {
		guildRolesResolved.clear();
		guildRolesInFlight.clear();
		roleIdToGuildId.clear();
		guildIdToRoleIds.clear();
		channelRoleCache.clear();
		channelRoleInflight.clear();
		bumpGuildRoleCacheRevision();
		return;
	}
	const key = String(guildId);
	guildRolesResolved.delete(key);
	guildRolesInFlight.delete(key);
	forgetGuildRoleMapping(key);
	channelRoleCache.delete(key);
	channelRoleInflight.delete(key);
	bumpGuildRoleCacheRevision();
}

export function writeGuildRoleCache(
	guildId: string | number | bigint | null | undefined,
	roles: DtoRole[]
) {
	const gid = toSnowflakeString(guildId);
	if (!gid) return;
	const snapshot = roles.map((role) => ({ ...role }));
	guildRolesResolved.set(gid, snapshot);
	guildRolesInFlight.delete(gid);
	trackRoleMapping(gid, snapshot);
	bumpGuildRoleCacheRevision();
}

export function mergeGuildRoleCache(
	guildId: string | number | bigint | null | undefined,
	roleId: string | number | bigint | null | undefined,
	update: Partial<DtoRole>
) {
	const gid = toSnowflakeString(guildId);
	const rid = toSnowflakeString(roleId);
	if (!gid || !rid) return;
	const existing = guildRolesResolved.get(gid);
	if (!existing || existing.length === 0) return;
	let changed = false;
	const next = existing.map((role) => {
		const currentId = toSnowflakeString((role as any)?.id);
		if (currentId && currentId === rid) {
			changed = true;
			return { ...role, ...update };
		}
		return role;
	});
	if (!changed) return;
	guildRolesResolved.set(gid, next);
	trackRoleMapping(gid, next);
	bumpGuildRoleCacheRevision();
}

function setChannelRoleCacheEntry(guildId: string, channelId: string, roleIds: string[]) {
	let guildCache = channelRoleCache.get(guildId);
	if (!guildCache) {
		guildCache = new Map<string, string[]>();
		channelRoleCache.set(guildId, guildCache);
	}
	guildCache.set(channelId, roleIds);
	channelRolesByGuild.update((map) => {
		const nextGuild = { ...(map[guildId] ?? {}) };
		nextGuild[channelId] = roleIds;
		return { ...map, [guildId]: nextGuild };
	});
}

function deleteChannelRoleCacheEntry(guildId: string, channelId: string) {
	const guildCache = channelRoleCache.get(guildId);
	if (guildCache) {
		guildCache.delete(channelId);
		if (guildCache.size === 0) {
			channelRoleCache.delete(guildId);
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
	const guildCache = channelRoleCache.get(gid);
	if (guildCache && guildCache.has(cid)) {
		return guildCache.get(cid);
	}
	const store = get(channelRolesByGuild);
	const stored = store[gid]?.[cid];
	if (stored) {
		setChannelRoleCacheEntry(gid, cid, stored);
		return stored;
	}
	return undefined;
}

async function fetchChannelRoleIds(guildId: string, channelId: string): Promise<string[]> {
	if (!guildId || guildId === '@me') return [];
	const response = await auth.api.guildRoles.guildGuildIdChannelChannelIdRolesGet({
		guildId: toApiSnowflake(guildId),
		channelId: toApiSnowflake(channelId)
	});
	const list = ((response as any)?.data ?? response ?? []) as GuildChannelRolePermission[];
	const ids = normalizeChannelRoleIds(list as any);
	setChannelRoleCacheEntry(guildId, channelId, ids);
	return ids;
}

export async function loadChannelRoleIds(
	guildId: string | number | bigint,
	channelId: string | number | bigint
): Promise<string[]> {
	const gid = toSnowflakeString(guildId);
	const cid = toSnowflakeString(channelId);
	if (!gid || gid === '@me' || !cid) return [];
	const cached = getCachedChannelRoleIds(gid, cid);
	if (cached) return cached;
	let guildInflight = channelRoleInflight.get(gid);
	if (!guildInflight) {
		guildInflight = new Map<string, Promise<string[]>>();
		channelRoleInflight.set(gid, guildInflight);
	}
	const existing = guildInflight.get(cid);
	if (existing) return existing;
	const pending = fetchChannelRoleIds(gid, cid)
		.catch((err) => {
			deleteChannelRoleCacheEntry(gid, cid);
			throw err;
		})
		.finally(() => {
			const current = channelRoleInflight.get(gid);
			current?.delete(cid);
			if (current && current.size === 0) {
				channelRoleInflight.delete(gid);
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
	if (!gid || gid === '@me' || !cid) return [];
	deleteChannelRoleCacheEntry(gid, cid);
	return loadChannelRoleIds(gid, cid);
}

export function invalidateChannelRoleIds(
	guildId: string | number | bigint,
	channelId?: string | number | bigint
) {
	const gid = toSnowflakeString(guildId);
	if (!gid || gid === '@me') return;
	if (channelId == null) {
		channelRoleCache.delete(gid);
		channelRoleInflight.delete(gid);
		channelRolesByGuild.update((map) => {
			if (!Object.prototype.hasOwnProperty.call(map, gid)) return map;
			const { [gid]: _removed, ...rest } = map;
			return rest;
		});
		return;
	}
	const cid = toSnowflakeString(channelId);
	if (!cid) return;
	deleteChannelRoleCacheEntry(gid, cid);
	const guildInflight = channelRoleInflight.get(gid);
	guildInflight?.delete(cid);
	if (guildInflight && guildInflight.size === 0) {
		channelRoleInflight.delete(gid);
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
	const guildCache = channelRoleCache.get(gid);
	if (guildCache) {
		for (const key of Array.from(guildCache.keys())) {
			if (!keep.has(key)) {
				guildCache.delete(key);
			}
		}
		if (guildCache.size === 0) {
			channelRoleCache.delete(gid);
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
