import type { DtoMember } from '$lib/api';

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

export function memberUserId(member: DtoMember | undefined): string | null {
	if (!member) return null;
	return (
		toSnowflakeString((member as any)?.user?.id) ??
		toSnowflakeString((member as any)?.user_id) ??
		toSnowflakeString((member as any)?.id) ??
		null
	);
}

export function collectMemberRoleIds(member: DtoMember | undefined): string[] {
	if (!member) return [];
	const roles = (member as any)?.roles;
	const list = Array.isArray(roles) ? roles : [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of list) {
                const id =
                        entry && typeof entry === 'object'
                                ? toSnowflakeString(
                                          (entry as any)?.id ??
                                                  (entry as any)?.role_id ??
                                                  (entry as any)?.roleId ??
                                                  (entry as any)?.role?.id ??
                                                  entry
                                      )
                                : toSnowflakeString(entry);
		if (id && !seen.has(id)) {
			seen.add(id);
			result.push(id);
		}
	}
	return result;
}

export type ResolveCurrentUserRoleIdsParams = {
	guildId: string | null | undefined;
	members: DtoMember[] | undefined;
	currentUserId: unknown;
	fallbackRoleIds: Iterable<unknown> | null | undefined;
};

export function resolveCurrentUserRoleIds({
	guildId,
	members,
	currentUserId,
	fallbackRoleIds
}: ResolveCurrentUserRoleIdsParams): Set<string> {
	const gid = toSnowflakeString(guildId);
	const meId = toSnowflakeString(currentUserId);
	const result = new Set<string>();

	if (fallbackRoleIds) {
		for (const entry of fallbackRoleIds) {
			const rid = toSnowflakeString(entry);
			if (rid) {
				result.add(rid);
			}
		}
	}

	if (Array.isArray(members) && meId) {
		const member = members.find((entry) => memberUserId(entry) === meId);
		if (member) {
			for (const roleId of collectMemberRoleIds(member)) {
				result.add(roleId);
			}
		}
	}

	if (gid) {
		result.add(gid);
	}

	return result;
}
