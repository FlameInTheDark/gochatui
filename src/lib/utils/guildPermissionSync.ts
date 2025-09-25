import { browser } from '$app/environment';
import { get } from 'svelte/store';
import type { DtoRole } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { wsEvent } from '$lib/client/ws';
import {
	loadGuildRolesCached,
	invalidateGuildRolesCache,
	getGuildIdForRole,
	rememberRoleGuild
} from '$lib/utils/guildRoles';
import { normalizePermissionValue } from '$lib/utils/permissions';

const guildPermissionInFlight = new Map<string, Promise<number>>();

function toSnowflakeString(value: unknown): string | null {
	if (value == null) return null;
	try {
		if (typeof value === 'string') return value;
		if (typeof value === 'bigint') return value.toString();
		if (typeof value === 'number') return BigInt(value).toString();
	} catch {
		try {
			return String(value);
		} catch {
			return null;
		}
	}
	return null;
}

function toApiSnowflake(value: string): any {
	try {
		return BigInt(value) as any;
	} catch {
		return value as any;
	}
}

function getRoleId(role: DtoRole | { id?: unknown } | null | undefined): string | null {
	if (!role) return null;
	const raw = (role as any)?.id;
	if (raw == null) return null;
	try {
		if (typeof raw === 'bigint') {
			return raw.toString();
		}
		return BigInt(raw).toString();
	} catch {
		try {
			return String(raw);
		} catch {
			return null;
		}
	}
}

function applyGuildPermissionSnapshot(guildId: string, base: number, effective: number) {
	const gid = String(guildId);
	if (!gid) return;
	auth.guilds.update((list) => {
		let changed = false;
		const next = list.map((guild) => {
			const id = toSnowflakeString((guild as any)?.id);
			if (!id || id !== gid) return guild;
			const currentBase = normalizePermissionValue(
				(guild as any)?.__basePermissions ?? (guild as any)?.permissions
			);
			const currentEffective = normalizePermissionValue(
				(guild as any)?.__effectivePermissions ?? currentBase
			);
			if (currentBase === base && currentEffective === effective) {
				return guild;
			}
			changed = true;
			return {
				...(guild as any),
				__basePermissions: base,
				__effectivePermissions: effective
			} as any;
		});
		return changed ? next : list;
	});
}

async function computeGuildEffectivePermissions(guildId: string): Promise<number> {
	const gid = String(guildId);
	if (!gid) return 0;
	const guild = get(auth.guilds).find((g) => toSnowflakeString((g as any)?.id) === gid);
	if (!guild) return 0;

	const baseStored = (guild as any)?.__basePermissions;
	const base = normalizePermissionValue(
		baseStored != null ? baseStored : (guild as any)?.permissions
	);

	const meId = toSnowflakeString(get(auth.user)?.id);
	if (!meId) {
		applyGuildPermissionSnapshot(gid, base, base);
		return base;
	}

	let effective = base;
	try {
		const [memberRolesRes, definitions] = await Promise.all([
			auth.api.guildRoles.guildGuildIdMemberUserIdRolesGet({
				guildId: toApiSnowflake(gid),
				userId: toApiSnowflake(meId)
			}),
			loadGuildRolesCached(gid)
		]);
		const memberRoles = ((memberRolesRes as any)?.data ?? memberRolesRes ?? []) as DtoRole[];
		const memberRoleIds = new Set<string>();
		for (const role of memberRoles) {
			const rid = getRoleId(role);
			if (rid) memberRoleIds.add(rid);
		}
		if (memberRoleIds.size > 0) {
			for (const role of definitions) {
				const rid = getRoleId(role);
				if (!rid || !memberRoleIds.has(rid)) continue;
				effective |= normalizePermissionValue((role as any)?.permissions);
			}
		}
	} catch {
		// fall back to base permissions on failure
	}

	applyGuildPermissionSnapshot(gid, base, effective);
	return effective;
}

export function refreshGuildEffectivePermissions(guildId: string): Promise<number> {
	const gid = String(guildId);
	if (!gid) return Promise.resolve(0);
	let pending = guildPermissionInFlight.get(gid);
	if (!pending) {
		pending = computeGuildEffectivePermissions(gid).finally(() => {
			guildPermissionInFlight.delete(gid);
		});
		guildPermissionInFlight.set(gid, pending);
	}
	return pending;
}

function collectRoleIdCandidates(data: any): string[] {
	const ids: string[] = [];
	const push = (value: unknown) => {
		const id = toSnowflakeString(value);
		if (id) ids.push(id);
	};
	const pushFromList = (list: any) => {
		if (!list) return;
		const arr = Array.isArray(list)
			? list
			: typeof list[Symbol.iterator] === 'function'
				? Array.from(list as Iterable<unknown>)
				: [];
		for (const entry of arr) {
			if (entry && typeof entry === 'object') {
				push((entry as any)?.id);
				push((entry as any)?.role_id);
				push((entry as any)?.roleId);
			}
			push(entry);
		}
	};
	pushFromList(data.roles);
	pushFromList(data.member?.roles);
	pushFromList(data.member_roles);
	pushFromList(data.updated_roles);
	pushFromList(data.added_roles);
	pushFromList(data.removed_roles);
	push(data.role_id);
	push(data.roleId);
	push(data.role?.id);
	push(data.added_role_id);
	push(data.added_role?.id);
	push(data.removed_role_id);
	push(data.removed_role?.id);
	return ids;
}

function findGuildIdFromRoles(candidateIds: Iterable<string>): string | null {
	const unique = new Set<string>();
	for (const id of candidateIds) {
		const rid = toSnowflakeString(id);
		if (!rid || unique.has(rid)) continue;
		unique.add(rid);
		const mapped = getGuildIdForRole(rid);
		if (mapped) return mapped;
	}
	const guildList = get(auth.guilds);
	for (const rid of unique) {
		const match = guildList.find((guild) => toSnowflakeString((guild as any)?.id) === rid);
		if (match) return rid;
	}
	return null;
}

function handleMemberRoleEvent(event: any): string | null {
	const data = event?.d ?? event;
	if (!data) return null;
	const rolesChanged =
		Array.isArray(data.roles) ||
		Array.isArray(data.member?.roles) ||
		data.role_id != null ||
		data.added_role_id != null ||
		data.removed_role_id != null;
	if (!rolesChanged) return null;
	const userId =
		toSnowflakeString(data.user_id) ||
		toSnowflakeString(data.userId) ||
		toSnowflakeString(data.member?.user_id) ||
		toSnowflakeString(data.member?.user?.id) ||
		toSnowflakeString(data.member?.id) ||
		toSnowflakeString(data.user?.id);
	if (!userId) return null;
	const meId = toSnowflakeString(get(auth.user)?.id);
	if (!meId || meId !== userId) return null;
	let guildId =
		toSnowflakeString(data.guild_id) ||
		toSnowflakeString(data.guildId) ||
		toSnowflakeString(data.guild?.id) ||
		toSnowflakeString(event?.guild_id) ||
		toSnowflakeString(event?.guildId) ||
		toSnowflakeString(event?.guild?.id);
	if (!guildId) {
		const roleIds = collectRoleIdCandidates(data);
		guildId = findGuildIdFromRoles(roleIds);
	}
	return guildId;
}

function handleRoleDefinitionEvent(event: any): string | null {
	const data = event?.d ?? event;
	if (!data) return null;
	const hasRolePayload =
		data.role != null ||
		Array.isArray(data.roles) ||
		Array.isArray(data.updated_roles) ||
		data.role_id != null;
	if (!hasRolePayload) return null;
	let guildId =
		toSnowflakeString(data.guild_id) ||
		toSnowflakeString(data.guildId) ||
		toSnowflakeString(data.guild?.id) ||
		toSnowflakeString(event?.guild_id) ||
		toSnowflakeString(event?.guildId) ||
		toSnowflakeString(event?.guild?.id);

	const registerRole = (role: any) => {
		if (!role) return;
		const rid = getRoleId(role);
		const gid =
			toSnowflakeString(role?.guild_id) ||
			toSnowflakeString(role?.guildId) ||
			toSnowflakeString(role?.guild?.id) ||
			guildId;
		if (rid && gid) {
			rememberRoleGuild(rid, gid);
			if (!guildId) guildId = gid;
		} else if (rid) {
			const known = getGuildIdForRole(rid);
			if (known && !guildId) {
				guildId = known;
			}
		}
	};

	if (data.role) registerRole(data.role);
	if (Array.isArray(data.roles)) {
		for (const role of data.roles) registerRole(role);
	}
	if (Array.isArray(data.updated_roles)) {
		for (const role of data.updated_roles) registerRole(role);
	}
	if (!guildId) {
		const fallback = findGuildIdFromRoles(collectRoleIdCandidates(data));
		if (fallback) guildId = fallback;
	}
	return guildId;
}

if (browser) {
	wsEvent.subscribe((ev) => {
		if (!ev || ev.op !== 0) return;
		const guildIdFromMember = handleMemberRoleEvent(ev);
		if (guildIdFromMember) {
			void refreshGuildEffectivePermissions(guildIdFromMember);
			return;
		}
		const guildIdFromRole = handleRoleDefinitionEvent(ev);
		if (guildIdFromRole) {
			invalidateGuildRolesCache(guildIdFromRole);
			void refreshGuildEffectivePermissions(guildIdFromRole);
		}
	});
}
