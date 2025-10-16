import type { GuildChannelRolePermission } from '$lib/api';
import { normalizePermissionValue, PERMISSION_VIEW_CHANNEL } from '$lib/utils/permissions';

type ChannelRoleLike =
	| GuildChannelRolePermission
	| (Partial<GuildChannelRolePermission> & { id?: unknown; roleId?: unknown });

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

export function filterViewableRoleIds(
	entries: Iterable<ChannelRoleLike | null | undefined> | null | undefined
): string[] {
	if (!entries) return [];
	const allowed: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (!entry) continue;
		const rawRoleId =
			(entry as any)?.role?.id ??
			(entry as any)?.role_id ??
			(entry as any)?.roleId ??
			(entry as any)?.id;
		let roleSource: unknown = rawRoleId;
		let accept: number | undefined;
		if (roleSource == null) {
			if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'bigint') {
				roleSource = entry;
				accept = PERMISSION_VIEW_CHANNEL;
			}
		}
		const roleId = toSnowflakeString(roleSource);
		if (!roleId || seen.has(roleId)) continue;
		const rawAccept = (entry as any)?.accept;
		if (accept == null) {
			accept = rawAccept == null ? PERMISSION_VIEW_CHANNEL : normalizePermissionValue(rawAccept);
		} else if (rawAccept != null) {
			accept = normalizePermissionValue(rawAccept);
		}
		const deny = normalizePermissionValue((entry as any)?.deny);
		if (deny & PERMISSION_VIEW_CHANNEL) continue;
		if (!(accept & PERMISSION_VIEW_CHANNEL)) continue;
		seen.add(roleId);
		allowed.push(roleId);
	}
	return allowed;
}
