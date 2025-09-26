import type { DtoMember } from '$lib/api';
import type { ChannelOverrideMap } from '$lib/utils/channelOverrides';
import { applyViewChannelOverrides, finalChannelAccessDecision } from '$lib/utils/channelOverrides';
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
	roleIds: string[];
	basePermissions: number;
	channelOverrides: ChannelOverrideMap;
	allowListedRoleIds: Iterable<string> | null | undefined;
	viewPermissionBit: number;
};

export type MemberChannelAccessDescription = {
        memberId: string | null;
        ownerId: string | null;
        guildId: string | null;
        roleIds: string[];
        allowList: string[];
        intersectingRoleIds: string[];
        isAdmin: boolean;
        isOwner: boolean;
        channelIsPrivate: boolean;
        privateGateAllows: boolean;
        basePermissions: number;
        viewPermissionBit: number;
        baseAllowed: boolean;
        overrideAllowed: boolean;
        finalAllowed: boolean;
};

function describeMemberChannelAccessInternal({
        member,
        channel,
        guild,
        guildId,
        roleIds,
        basePermissions,
        channelOverrides,
        allowListedRoleIds,
        viewPermissionBit
}: MemberChannelAccessParams): MemberChannelAccessDescription {
        const ownerId = toSnowflakeString((guild as any)?.owner);
        const memberId = toSnowflakeString((member as any)?.user?.id);
        const channelIsPrivate = Boolean((channel as any)?.private);
        const allowList = channelIsPrivate ? Array.from(allowListedRoleIds ?? []) : [];
        const allowSet = new Set(allowList);
        const intersectingRoleIds = channelIsPrivate
                ? roleIds.filter((roleId) => allowSet.has(roleId))
                : [];
        const isAdmin = Boolean(basePermissions & PERMISSION_ADMINISTRATOR);
        const isOwner = Boolean(ownerId && memberId && ownerId === memberId);

        let privateGateAllows = true;
        if (channelIsPrivate) {
                if (!allowSet.size) {
                        privateGateAllows = isAdmin || isOwner;
                } else {
                        privateGateAllows = Boolean(intersectingRoleIds.length || isAdmin || isOwner);
                }
        }

        const baseAllowed = Boolean(basePermissions & viewPermissionBit) || isAdmin;
        const overrideAllowed = applyViewChannelOverrides(
                baseAllowed,
                roleIds,
                guildId,
                channelOverrides,
                viewPermissionBit
        );

        const finalAllowed = privateGateAllows
                ? finalChannelAccessDecision(
                          overrideAllowed,
                          basePermissions,
                          PERMISSION_ADMINISTRATOR,
                          ownerId,
                          memberId,
                          channelIsPrivate
                  )
                : false;

        return {
                memberId,
                ownerId,
                guildId,
                roleIds: [...roleIds],
                allowList,
                intersectingRoleIds,
                isAdmin,
                isOwner,
                channelIsPrivate,
                privateGateAllows,
                basePermissions,
                viewPermissionBit,
                baseAllowed,
                overrideAllowed,
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
