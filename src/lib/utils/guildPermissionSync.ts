import { browser } from '$app/environment';
import { get } from 'svelte/store';
import type { DtoMember, DtoRole } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { wsEvent } from '$lib/client/ws';
import {
        loadGuildRolesCached,
        invalidateGuildRolesCache,
        getGuildIdForRole,
        rememberRoleGuild,
        refreshChannelRoleIds
} from '$lib/utils/guildRoles';
import { refreshChannelRoleIds } from '$lib/utils/channelRoles';
import { normalizePermissionValue } from '$lib/utils/permissions';
import {
        channelOverridesRefreshToken,
        membersByGuild,
        selectedChannelId,
        selectedGuildId
} from '$lib/stores/appState';
import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';

const guildPermissionInFlight = new Map<string, Promise<number>>();

const WS_EVENT_MEMBER_ROLE_ADD = 203;
const WS_EVENT_MEMBER_ROLE_REMOVE = 204;

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
                                push((entry as any)?.role?.id);
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
        const seen = new Set<string>();
        const unresolved = new Set<string>();

        for (const id of candidateIds) {
                const rid = toSnowflakeString(id);
                if (!rid || seen.has(rid)) continue;
                seen.add(rid);

                const mapped = getGuildIdForRole(rid);
                if (mapped) return mapped;

                unresolved.add(rid);
        }

        if (!unresolved.size) return null;

        const memberMap = get(membersByGuild);
        if (memberMap) {
                for (const [rawGuildId, members] of Object.entries(memberMap)) {
                        if (!Array.isArray(members) || !members.length) continue;
                        const guildId = toSnowflakeString(rawGuildId);
                        if (!guildId) continue;

                        let matched = false;
                        for (const member of members) {
                                const roleIds = getMemberRoleIds(member);
                                if (!roleIds.length) continue;
                                for (const rid of roleIds) {
                                        if (!unresolved.has(rid)) continue;
                                        rememberRoleGuild(rid, guildId);
                                        unresolved.delete(rid);
                                        matched = true;
                                }
                        }

                        if (matched) {
                                return guildId;
                        }
                }
        }

        return null;
}

function resolveRoleIdCandidate(candidate: any): string | null {
        if (candidate && typeof candidate === 'object') {
                const nested =
                        (candidate as any)?.role_id ??
                        (candidate as any)?.roleId ??
                        (candidate as any)?.role?.id ??
                        (candidate as any)?.id;
                const nestedId = toSnowflakeString(nested);
                if (nestedId) return nestedId;
        }
        return toSnowflakeString(candidate);
}

function collectRoleIds(value: any): string[] {
        const result: string[] = [];
        const seen = new Set<string>();
        const push = (candidate: any) => {
                const id = resolveRoleIdCandidate(candidate);
                if (id && !seen.has(id)) {
                        seen.add(id);
                        result.push(id);
                }
        };
        if (Array.isArray(value)) {
                for (const entry of value) push(entry);
        } else if (value && typeof value === 'object' && typeof (value as any)[Symbol.iterator] === 'function') {
                for (const entry of value as Iterable<any>) push(entry);
        } else if (value != null) {
                push(value);
        }
        return result;
}

function getMemberRoleIds(member: DtoMember | undefined): string[] {
        if (!member) return [];
        const roles = (member as any)?.roles;
        return collectRoleIds(Array.isArray(roles) ? roles : []);
}

function computeUpdatedMemberRoleIds(
        member: DtoMember | undefined,
        data: any,
        eventType: number | null | undefined
): string[] | null {
        const directRoles = collectRoleIds(data?.roles);
        if (directRoles.length > 0) return directRoles;

        const nestedRoles = collectRoleIds(data?.member?.roles);
        if (nestedRoles.length > 0) return nestedRoles;

        const altRoles = collectRoleIds(data?.member_roles);
        if (altRoles.length > 0) return altRoles;

        const current = getMemberRoleIds(member);
        const next = current.slice();
        const seen = new Set(next);
        let changed = false;

        const applyAdditions = (source: any) => {
                const list = collectRoleIds(source);
                if (!list.length) return;
                for (const id of list) {
                        if (seen.has(id)) continue;
                        seen.add(id);
                        next.push(id);
                        changed = true;
                }
        };

        const applyRemovals = (source: any) => {
                const list = collectRoleIds(source);
                if (!list.length) return;
                for (const id of list) {
                        if (!seen.has(id)) continue;
                        const index = next.indexOf(id);
                        if (index !== -1) {
                                next.splice(index, 1);
                                changed = true;
                        }
                        seen.delete(id);
                }
        };

        applyAdditions(data?.added_roles);
        applyAdditions(data?.added_role);
        applyAdditions(data?.added_role_id);
        applyAdditions(data?.added_role_ids);
        applyAdditions(data?.add_roles);
        applyAdditions(data?.add_role);
        applyAdditions(data?.add_role_id);

        applyRemovals(data?.removed_roles);
        applyRemovals(data?.removed_role);
        applyRemovals(data?.removed_role_id);
        applyRemovals(data?.removed_role_ids);
        applyRemovals(data?.remove_roles);
        applyRemovals(data?.remove_role);
        applyRemovals(data?.remove_role_id);

        const directPayloads = [data?.role, data?.role_id, data?.roleId, data?.role?.id];
        if (eventType === WS_EVENT_MEMBER_ROLE_ADD) {
                for (const payload of directPayloads) {
                        applyAdditions(payload);
                }
        } else if (eventType === WS_EVENT_MEMBER_ROLE_REMOVE) {
                for (const payload of directPayloads) {
                        applyRemovals(payload);
                }
        }

        return changed ? next : null;
}

function updateCachedMemberRoles(
        guildId: string,
        userId: string,
        payload: any,
        eventType: number | null | undefined
): 'updated' | 'missing' | 'noop' {
        let result: 'updated' | 'missing' | 'noop' = 'missing';
        membersByGuild.update((map) => {
                if (!map) return map;
                const list = map[guildId];
                if (!Array.isArray(list)) {
                        result = 'missing';
                        return map;
                }
                const index = list.findIndex((entry) => {
                        const id =
                                toSnowflakeString((entry as any)?.user?.id) ||
                                toSnowflakeString((entry as any)?.id);
                        return id === userId;
                });
                if (index === -1) {
                        result = 'missing';
                        return map;
                }
                const member = list[index];
                const updatedRoleIds = computeUpdatedMemberRoleIds(member, payload, eventType);
                if (!updatedRoleIds) {
                        result = 'noop';
                        return map;
                }
                const currentRoleIds = getMemberRoleIds(member);
                if (
                        currentRoleIds.length === updatedRoleIds.length &&
                        currentRoleIds.every((value, idx) => value === updatedRoleIds[idx])
                ) {
                        result = 'noop';
                        return map;
                }

                const storedRoles = updatedRoleIds.map((id) => toApiSnowflake(id));
                const nextMember = { ...(member as any), roles: storedRoles } as DtoMember;
                const nextList = list.slice();
                nextList[index] = nextMember;
                result = 'updated';
                return { ...map, [guildId]: nextList };
        });
        return result;
}

type MemberRoleEvent = {
        guildId: string;
        userId: string;
        payload: any;
        isCurrentUser: boolean;
        eventType: number | null;
};

function handleMemberRoleEvent(event: any): MemberRoleEvent | null {
        const data = event?.d ?? event;
        if (!data) return null;
        const rolesChanged =
                Array.isArray(data.roles) ||
                Array.isArray(data.member?.roles) ||
                Array.isArray(data.member_roles) ||
                data.role_id != null ||
                data.added_role_id != null ||
                data.removed_role_id != null ||
                data.added_roles != null ||
                data.removed_roles != null;
        if (!rolesChanged) return null;
        const userId =
                toSnowflakeString(data.user_id) ||
                toSnowflakeString(data.userId) ||
                toSnowflakeString(data.member?.user_id) ||
                toSnowflakeString(data.member?.user?.id) ||
                toSnowflakeString(data.member?.id) ||
                toSnowflakeString(data.user?.id);
        if (!userId) return null;
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
        if (!guildId) return null;
        const meId = toSnowflakeString(get(auth.user)?.id);
        const eventType = typeof event?.t === 'number' ? event.t : typeof data?.t === 'number' ? data.t : null;
        return {
                guildId,
                userId,
                payload: data,
                isCurrentUser: Boolean(meId && meId === userId),
                eventType
        };
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

function handleChannelOverrideEvent(event: any): boolean {
        const data = event?.d ?? event;
        if (!data) return false;
        const channelId =
                toSnowflakeString(data.channel_id) ||
                toSnowflakeString(data.channelId) ||
                toSnowflakeString(data.channel?.id);
        if (!channelId) return false;
        const hasRolePayload =
                data.role != null ||
                data.role_id != null ||
                data.roleId != null ||
                Array.isArray(data.roles) ||
                Array.isArray(data.updated_roles) ||
                data.added_role_id != null ||
                data.removed_role_id != null ||
                data.added_roles != null ||
                data.removed_roles != null;
        if (!hasRolePayload) return false;

        const eventGuildId =
                toSnowflakeString(data.guild_id) ||
                toSnowflakeString(data.guildId) ||
                toSnowflakeString(data.guild?.id);
        if (eventGuildId && channelId) {
                void refreshChannelRoleIds(eventGuildId, channelId).catch(() => {});
        }

        const selectedChannel = toSnowflakeString(get(selectedChannelId));
        if (!selectedChannel || selectedChannel !== channelId) return false;

        const currentGuildId = toSnowflakeString(get(selectedGuildId));
        if (currentGuildId && eventGuildId && currentGuildId !== eventGuildId) return false;
        if (!currentGuildId && !eventGuildId) return false;

        channelOverridesRefreshToken.update((value) => value + 1);
        return true;
}

if (browser) {
        wsEvent.subscribe((ev) => {
                if (!ev || ev.op !== 0) return;
                const memberEvent = handleMemberRoleEvent(ev);
                if (memberEvent) {
                        const { guildId, userId, payload, isCurrentUser, eventType } = memberEvent;
                        const status = updateCachedMemberRoles(guildId, userId, payload, eventType);
                        if (status === 'missing') {
                                void ensureGuildMembersLoaded(guildId);
                        }
                        if (isCurrentUser) {
                                void refreshGuildEffectivePermissions(guildId);
                        }
                        return;
                }
                if (handleChannelOverrideEvent(ev)) {
                        return;
                }
                const guildIdFromRole = handleRoleDefinitionEvent(ev);
                if (guildIdFromRole) {
                        invalidateGuildRolesCache(guildIdFromRole);
			void refreshGuildEffectivePermissions(guildIdFromRole);
		}
	});
}
