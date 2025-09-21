import { browser } from '$app/environment';
import { get } from 'svelte/store';
import type { DtoRole } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { wsEvent } from '$lib/client/ws';
import { loadGuildRolesCached, invalidateGuildRolesCache } from '$lib/utils/guildRoles';
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
                        const currentBase = normalizePermissionValue((guild as any)?.__basePermissions ?? (guild as any)?.permissions);
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
        const base = normalizePermissionValue(baseStored != null ? baseStored : (guild as any)?.permissions);

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

function handleMemberRoleEvent(data: any): string | null {
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
        const guildId =
                toSnowflakeString(data.guild_id) ||
                toSnowflakeString(data.guildId) ||
                toSnowflakeString(data.guild?.id);
        return guildId;
}

function handleRoleDefinitionEvent(data: any): string | null {
        if (!data) return null;
        const hasRolePayload =
                data.role != null ||
                Array.isArray(data.roles) ||
                Array.isArray(data.updated_roles) ||
                data.role_id != null;
        if (!hasRolePayload) return null;
        const guildId =
                toSnowflakeString(data.guild_id) ||
                toSnowflakeString(data.guildId) ||
                toSnowflakeString(data.guild?.id);
        return guildId;
}

if (browser) {
        wsEvent.subscribe((ev) => {
                if (!ev || ev.op !== 0) return;
                const data = ev.d ?? {};
                const guildIdFromMember = handleMemberRoleEvent(data);
                if (guildIdFromMember) {
                        void refreshGuildEffectivePermissions(guildIdFromMember);
                        return;
                }
                const guildIdFromRole = handleRoleDefinitionEvent(data);
                if (guildIdFromRole) {
                        invalidateGuildRolesCache(guildIdFromRole);
                        void refreshGuildEffectivePermissions(guildIdFromRole);
                }
        });
}
