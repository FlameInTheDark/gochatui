import type { DtoRole } from '$lib/api';
import { auth } from '$lib/stores/auth';

const guildRolesResolved = new Map<string, DtoRole[]>();
const guildRolesInFlight = new Map<string, Promise<DtoRole[]>>();
const roleIdToGuildId = new Map<string, string>();
const guildIdToRoleIds = new Map<string, Set<string>>();

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
	if (!key) return [];

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
		return;
	}
	const key = String(guildId);
	guildRolesResolved.delete(key);
	guildRolesInFlight.delete(key);
	forgetGuildRoleMapping(key);
}
