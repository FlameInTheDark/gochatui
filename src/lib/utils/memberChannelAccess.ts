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

export function memberHasChannelAccess({
	member,
	channel,
	guild,
	guildId,
	roleIds,
	basePermissions,
	channelOverrides,
	allowListedRoleIds,
	viewPermissionBit
}: MemberChannelAccessParams): boolean {
	if (!member || !channel) return false;

	const ownerId = toSnowflakeString((guild as any)?.owner);
	const memberId = toSnowflakeString((member as any)?.user?.id);
	const isAdmin = Boolean(basePermissions & PERMISSION_ADMINISTRATOR);
	const isOwner = Boolean(ownerId && memberId && ownerId === memberId);
	const channelIsPrivate = Boolean((channel as any)?.private);

	if (channelIsPrivate) {
		const allowList = Array.from(allowListedRoleIds ?? []);
		const allowSet = new Set(allowList);
		if (!allowSet.size) {
			if (!isAdmin && !isOwner) {
				return false;
			}
		} else {
			let intersects = false;
			for (const roleId of roleIds) {
				if (allowSet.has(roleId)) {
					intersects = true;
					break;
				}
			}
			if (!intersects && !isAdmin && !isOwner) {
				return false;
			}
		}
	}

	let allowed = Boolean(basePermissions & viewPermissionBit) || isAdmin;
	allowed = applyViewChannelOverrides(
		allowed,
		roleIds,
		guildId,
		channelOverrides,
		viewPermissionBit
	);

	return finalChannelAccessDecision(
		allowed,
		basePermissions,
		PERMISSION_ADMINISTRATOR,
		ownerId,
		memberId,
		channelIsPrivate
	);
}
