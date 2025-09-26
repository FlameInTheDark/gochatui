import type { DtoGuild } from '$lib/api';

export const PERMISSION_VIEW_CHANNEL = 1 << 0;
export const PERMISSION_MANAGE_CHANNELS = 1 << 1;
export const PERMISSION_MANAGE_ROLES = 1 << 2;
export const PERMISSION_MANAGE_GUILD = 1 << 4;
export const PERMISSION_CREATE_INVITES = 1 << 5;
export const PERMISSION_KICK_MEMBERS = 1 << 8;
export const PERMISSION_BAN_MEMBERS = 1 << 9;
export const PERMISSION_TIMEOUT_MEMBERS = 1 << 10;
export const PERMISSION_ADMINISTRATOR = 1 << 26;

export function normalizePermissionValue(value: unknown): number {
        if (typeof value === 'number') {
                return Number.isFinite(value) ? value : 0;
        }
        if (typeof value === 'bigint') {
                return Number(value);
        }
        if (typeof value === 'string') {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
}

function toSnowflakeString(value: unknown): string | null {
        if (value == null) return null;
        try {
                return String(value);
        } catch {
                return null;
        }
}

export function getGuildPermissionValue(
        guild: (Pick<DtoGuild, 'permissions'> & { __effectivePermissions?: unknown }) | null | undefined
): number {
        if (!guild) return 0;
        const effective = (guild as any)?.__effectivePermissions;
        if (effective != null) {
                return normalizePermissionValue(effective);
        }
        return normalizePermissionValue(guild?.permissions);
}

export function isGuildOwner(
        guild: Pick<DtoGuild, 'owner'> | null | undefined,
        userId: unknown
): boolean {
        const ownerId = toSnowflakeString(guild?.owner);
        const currentId = toSnowflakeString(userId);
        return ownerId != null && currentId != null && ownerId === currentId;
}

export function hasGuildPermission(
        guild: DtoGuild | null | undefined,
        userId: unknown,
        mask: number
): boolean {
        if (!guild) return false;
        if (isGuildOwner(guild, userId)) return true;
        const perms = getGuildPermissionValue(guild);
        if (perms & PERMISSION_ADMINISTRATOR) return true;
        return Boolean(perms & mask);
}

export function hasAnyGuildPermission(
        guild: DtoGuild | null | undefined,
        userId: unknown,
        ...masks: number[]
): boolean {
        if (!guild) return false;
        if (isGuildOwner(guild, userId)) return true;
        const perms = getGuildPermissionValue(guild);
        if (perms & PERMISSION_ADMINISTRATOR) return true;
        return masks.some((mask) => Boolean(perms & mask));
}
