import type { DtoMember, DtoRole } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { membersByGuild } from '$lib/stores/appState';
import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
import type { ContextMenuActionItem, ContextMenuItem } from '$lib/stores/contextMenu';
import { m } from '$lib/paraglide/messages.js';
import { PERMISSION_MANAGE_ROLES, hasGuildPermission } from '$lib/utils/permissions';
import { loadGuildRolesCached } from '$lib/utils/guildRoles';
import { refreshGuildEffectivePermissions } from '$lib/utils/guildPermissionSync';
import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
import { get } from 'svelte/store';

function toSnowflake(value: unknown): string | null {
	if (value == null) return null;
	try {
		if (typeof value === 'string') return value;
		if (typeof value === 'bigint') return value.toString();
		if (typeof value === 'number') {
			return BigInt(value).toString();
		}
		return String(value);
	} catch {
		try {
			return String(value);
		} catch {
			return null;
		}
	}
}

function getRoleId(role?: DtoRole | null): string | null {
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

async function loadMemberRoleIds(guildId: string, userId: string): Promise<Set<string>> {
	const res = await auth.api.guildRoles.guildGuildIdMemberUserIdRolesGet({
		guildId: BigInt(guildId) as any,
		userId: BigInt(userId) as any
	});
	const list = ((res as any)?.data ?? res ?? []) as DtoRole[];
	const ids = new Set<string>();
	for (const role of list) {
		const id = getRoleId(role);
		if (id) {
			ids.add(id);
		}
	}
	return ids;
}

function resolveTargetUserId(target: UserContextMenuTarget): string | null {
	const direct = toSnowflake(target.userId);
	if (direct) return direct;
	const memberUser = toSnowflake((target.member as any)?.user?.id);
	if (memberUser) return memberUser;
	return toSnowflake((target.user as any)?.id);
}

function resolveGuildId(context?: UserContextMenuContext): string | null {
	if (!context) return null;
	return toSnowflake(context.guildId);
}

export type UserContextMenuTarget = {
	userId?: unknown;
	user?: { id?: unknown } | null | undefined;
	member?: DtoMember | null | undefined;
};

export type UserContextMenuContext = {
	guildId?: unknown;
	channelId?: unknown;
};

export function openUserContextMenu(
	event: MouseEvent,
	target: UserContextMenuTarget,
	context?: UserContextMenuContext
): void {
	const userId = resolveTargetUserId(target);
	const guildId = resolveGuildId(context);

	const items: ContextMenuItem[] = [
		{
			label: m.ctx_copy_user_id(),
			action: userId ? () => copyToClipboard(userId) : undefined,
			disabled: !userId
		}
	];

	const guildList = get(auth.guilds);
	const me = get(auth.user);
	const guild = guildId ? guildList.find((g) => toSnowflake((g as any)?.id) === guildId) : null;
	const canManageRoles = Boolean(
		guildId && userId && guild && hasGuildPermission(guild as any, me?.id, PERMISSION_MANAGE_ROLES)
	);

        let rolesItem: ContextMenuActionItem | null = null;
	let rolesIndex = -1;
	let resolvedMember: DtoMember | null = null;
	let shouldShowRolesSubmenu = canManageRoles && Boolean(guildId && userId);
	const resolveMemberFromList = (list: DtoMember[] | undefined | null): DtoMember | null => {
		if (!list) return null;
		for (const member of list) {
			const memberId = toSnowflake((member as any)?.user?.id);
			if (memberId && memberId === userId) {
				return member;
			}
		}
		return null;
	};

	if (shouldShowRolesSubmenu && guildId && userId) {
		const directMember = target.member;
		if (toSnowflake((directMember as any)?.user?.id) === userId) {
			resolvedMember = directMember ?? null;
		}
		if (!resolvedMember) {
			const map = get(membersByGuild);
			const cachedMembers = map[guildId];
			resolvedMember = resolveMemberFromList(cachedMembers);
			if (cachedMembers !== undefined && !resolvedMember) {
				// Members are cached but this user is not present; omit the submenu entirely.
				shouldShowRolesSubmenu = false;
			}
		}
	}

	if (shouldShowRolesSubmenu && guildId && userId) {
                rolesItem = {
                        label: m.ctx_roles_menu(),
                        children: [{ label: m.ctx_roles_loading(), disabled: true }]
                };
		items.push(rolesItem);
		rolesIndex = items.length - 1;
	}

	const { clientX, clientY } = event;
	contextMenu.openFromEvent(event, items);

	let allowRefresh = true;
	let unsubscribe: (() => void) | null = null;
	let isRolesSubmenuOpen = false;

	const refreshMenu = (forceOpenSubmenu = false) => {
		if (!allowRefresh) return;
		const shouldOpen = (forceOpenSubmenu || isRolesSubmenuOpen) && rolesIndex >= 0;
		contextMenu.openAt(clientX, clientY, items);
		if (shouldOpen) {
			setTimeout(() => {
				if (!allowRefresh) return;
				contextMenu.openSubmenu(rolesIndex);
			}, 0);
		}
	};

	refreshMenu(false);

	unsubscribe = contextMenu.subscribe((state) => {
		if (state.items === items) {
			isRolesSubmenuOpen = state.openSubmenuIndex === rolesIndex;
		}
		if (state.items !== items || !state.open) {
			allowRefresh = false;
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = null;
			}
		}
	});

	if (!rolesItem || !guildId || !userId) {
		return;
	}

	const guildSnowflake = (() => {
		try {
			return BigInt(guildId) as any;
		} catch {
			return null;
		}
	})();
	const userSnowflake = (() => {
		try {
			return BigInt(userId) as any;
		} catch {
			return null;
		}
	})();

	if (guildSnowflake == null || userSnowflake == null) {
		rolesItem.children = [{ label: m.ctx_roles_error_loading(), disabled: true }];
		refreshMenu();
		return;
	}

	void (async () => {
		try {
			const rolesPromise = loadGuildRolesCached(guildId);
			if (!resolvedMember) {
				const ensuredMembers = await ensureGuildMembersLoaded(guildId).catch(() => []);
				if (!allowRefresh) return;
				resolvedMember = resolveMemberFromList(ensuredMembers);
				if (!resolvedMember) {
					const latestMap = get(membersByGuild);
					resolvedMember = resolveMemberFromList(latestMap[guildId]);
				}
				if (!resolvedMember) {
					rolesItem.children = [{ label: m.ctx_roles_error_loading(), disabled: true }];
					refreshMenu();
					return;
				}
			}

			const [roles, memberRoleIds] = await Promise.all([
				rolesPromise,
				loadMemberRoleIds(guildId, userId)
			]);
			if (!allowRefresh) return;

                        const roleItems: ContextMenuActionItem[] = [];
                        for (const role of roles) {
                                const rid = getRoleId(role);
                                if (!rid) continue;
                                const roleName = String(role.name ?? 'Role');
                                const labelForState = (assigned: boolean) =>
                                        assigned
                                                ? m.ctx_roles_item_assigned({ role: roleName })
                                                : m.ctx_roles_item_unassigned({ role: roleName });
                                const item: ContextMenuActionItem = {
                                        label: labelForState(memberRoleIds.has(rid))
                                };
				item.action = async () => {
					const assigned = memberRoleIds.has(rid);
					let roleSnowflake: any;
					try {
						roleSnowflake = BigInt(rid) as any;
					} catch {
						return;
					}
					item.disabled = true;
					item.label = m.ctx_roles_item_updating({ role: roleName });
					refreshMenu(true);
					try {
						if (assigned) {
							await auth.api.guildRoles.guildGuildIdMemberUserIdRolesRoleIdDelete({
								guildId: guildSnowflake,
								userId: userSnowflake,
								roleId: roleSnowflake
							});
							memberRoleIds.delete(rid);
						} else {
							await auth.api.guildRoles.guildGuildIdMemberUserIdRolesRoleIdPut({
								guildId: guildSnowflake,
								userId: userSnowflake,
								roleId: roleSnowflake
							});
							memberRoleIds.add(rid);
						}
						const currentUserId = toSnowflake(get(auth.user)?.id);
						if (currentUserId && currentUserId === userId) {
							void refreshGuildEffectivePermissions(guildId);
						}
						item.label = labelForState(memberRoleIds.has(rid));
						item.disabled = false;
						refreshMenu(true);
					} catch {
						item.label = m.ctx_roles_error_updating();
						refreshMenu(true);
						setTimeout(() => {
							if (!allowRefresh) return;
							item.label = labelForState(memberRoleIds.has(rid));
							item.disabled = false;
							refreshMenu(true);
						}, 1200);
					}
				};
				roleItems.push(item);
			}

                        rolesItem.children = roleItems.length
                                ? roleItems
                                : [{ label: m.ctx_roles_empty(), disabled: true }];
			refreshMenu();
		} catch {
			if (!allowRefresh) return;
                        rolesItem.children = [{ label: m.ctx_roles_error_loading(), disabled: true }];
			refreshMenu();
		}
	})();
}
