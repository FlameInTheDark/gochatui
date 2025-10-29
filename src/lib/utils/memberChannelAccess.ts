import type { DtoMember } from '$lib/api';
import { PERMISSION_ADMINISTRATOR } from '$lib/utils/permissions';

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

export type MemberChannelAccessParams = {
        member: DtoMember | null | undefined;
        channel: any;
        guild: any;
        guildId: string | null;
        memberRoleIds: string[];
        channelRoleIds: Iterable<string> | null | undefined;
};

export type MemberChannelAccessDescription = {
        memberId: string | null;
        ownerId: string | null;
        guildId: string | null;
        memberRoleIds: string[];
        channelRoleIds: string[];
        intersectingRoleIds: string[];
        isAdmin: boolean;
        isOwner: boolean;
        channelIsPrivate: boolean;
        privateGateAllows: boolean;
        finalAllowed: boolean;
};

function toPermissionNumber(value: unknown): number | null {
        if (value == null) return null;
        if (typeof value === 'boolean') return value ? PERMISSION_ADMINISTRATOR : 0;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'bigint') return Number(value);
        if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return null;
                const parsed = Number(trimmed);
                return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
}

function resolveAdministratorFlag(member: unknown): boolean {
        if (!member || typeof member !== 'object') return false;
        const candidate =
                (member as any)?.administrator ??
                (member as any)?.admin ??
                (member as any)?.is_admin ??
                (member as any)?.isAdmin;
        if (typeof candidate === 'boolean') {
                return candidate;
        }
        if (candidate != null) {
                return Boolean(candidate);
        }

        const permissionSources: unknown[] = [
                (member as any)?.permissions,
                (member as any)?.permission,
                (member as any)?.basePermissions,
                (member as any)?.user?.permissions
        ];

        for (const source of permissionSources) {
                const numeric = toPermissionNumber(source);
                if (numeric == null) continue;
                if (Boolean(numeric & PERMISSION_ADMINISTRATOR)) {
                        return true;
                }
        }

        const roles = Array.isArray((member as any)?.roles) ? (member as any)?.roles : [];
        for (const entry of roles) {
                if (!entry || typeof entry !== 'object') continue;
                const numeric = toPermissionNumber((entry as any)?.permissions ?? (entry as any)?.permission);
                if (numeric == null) continue;
                if (Boolean(numeric & PERMISSION_ADMINISTRATOR)) {
                        return true;
                }
        }

        return false;
}

function describeMemberChannelAccessInternal({
        member,
        channel,
        guild,
        guildId,
        memberRoleIds,
        channelRoleIds
}: MemberChannelAccessParams): MemberChannelAccessDescription {
        const ownerId = toSnowflakeString((guild as any)?.owner);
        const memberId = toSnowflakeString((member as any)?.user?.id);
        const channelIsPrivate = Boolean((channel as any)?.private);
        const allowList = Array.from(channelRoleIds ?? []);
        const allowSet = new Set(allowList);
        const intersectingRoleIds = memberRoleIds.filter((roleId) => allowSet.has(roleId));
        const isAdmin = resolveAdministratorFlag(member);
        const isOwner = Boolean(ownerId && memberId && ownerId === memberId);

        const privateGateAllows = !channelIsPrivate
                ? true
                : Boolean(isOwner || isAdmin || intersectingRoleIds.length > 0);

        const finalAllowed = Boolean(isOwner || isAdmin || !channelIsPrivate || intersectingRoleIds.length > 0);

        return {
                memberId,
                ownerId,
                guildId,
                memberRoleIds: [...memberRoleIds],
                channelRoleIds: allowList,
                intersectingRoleIds,
                isAdmin,
                isOwner,
                channelIsPrivate,
                privateGateAllows,
                finalAllowed
        };
}

export const describeMemberChannelAccess = import.meta.env.DEV
        ? describeMemberChannelAccessInternal
        : undefined;

export function memberHasChannelAccess(params: MemberChannelAccessParams): boolean {
        if (!params.member || !params.channel) return false;
        return describeMemberChannelAccessInternal(params).finalAllowed;
}
