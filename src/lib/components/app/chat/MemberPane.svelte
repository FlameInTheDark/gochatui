<script lang="ts">
	import type { DtoMember, DtoRole, GuildChannelRolePermission } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import {
		channelOverridesRefreshToken,
		channelsByGuild,
		channelRolesByGuild,
		membersByGuild,
		selectedChannelId,
		selectedGuildId
	} from '$lib/stores/appState';
	import { colorIntToHex } from '$lib/utils/color';
	import { loadGuildRolesCached } from '$lib/utils/guildRoles';
	import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
	import type { ChannelOverrideMap } from '$lib/utils/channelOverrides';
	import { normalizePermissionValue } from '$lib/utils/permissions';
	import { m } from '$lib/paraglide/messages.js';
	import { openUserContextMenu } from '$lib/utils/userContextMenu';
	import { channelAllowListedRoleIds } from '$lib/utils/channelRoles';
        import { memberHasChannelAccess as resolveMemberChannelAccess } from '$lib/utils/memberChannelAccess';
        import { collectMemberRoleIds as resolveMemberRoleIds } from '$lib/utils/currentUserRoleIds';

	const guilds = auth.guilds;

	const VIEW_CHANNEL = 1 << 0;

	let loadingMembers = $state(false);
	let membersError = $state<string | null>(null);
	let roleMap = $state<Record<string, DtoRole>>({});
	let channelOverrides = $state<ChannelOverrideMap>({});

	let membersLoadToken = 0;
	let overridesLoadToken = 0;

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

	function toApiSnowflake(value: string): any {
		try {
			return BigInt(value) as any;
		} catch {
			return value as any;
		}
	}

	function memberPrimaryName(member: DtoMember | null | undefined): string {
		if (!member) return m.user_default_name();
		const nickname = (member as any)?.username;
		if (typeof nickname === 'string' && nickname.trim()) return nickname.trim();
		const userName = (member as any)?.user?.name;
		if (typeof userName === 'string' && userName.trim()) return userName.trim();
		const id = toSnowflakeString((member as any)?.user?.id);
		if (id) return `${m.user_default_name()} ${id}`;
		return m.user_default_name();
	}

	function memberSecondaryName(member: DtoMember | null | undefined): string {
		if (!member) return '';
		const primary = memberPrimaryName(member);
		const userName = (member as any)?.user?.name;
		if (typeof userName === 'string') {
			const trimmed = userName.trim();
			if (trimmed && trimmed !== primary) {
				return trimmed;
			}
		}
		const discriminator = (member as any)?.user?.discriminator;
		if (typeof discriminator === 'string' && discriminator.trim()) {
			return discriminator.trim();
		}
		return '';
	}

	function memberInitial(member: DtoMember | null | undefined): string {
		const primary = memberPrimaryName(member);
		return primary.trim().charAt(0).toUpperCase() || '?';
	}

	function buildRoleMap(list: DtoRole[]): Record<string, DtoRole> {
		const map: Record<string, DtoRole> = {};
		for (const role of list) {
			const id = toSnowflakeString((role as any)?.id);
			if (!id) continue;
			map[id] = role;
		}
		return map;
	}

	function resolveChannelOverrides(
		list: GuildChannelRolePermission[]
	): Record<string, { accept: number; deny: number }> {
		const map: Record<string, { accept: number; deny: number }> = {};
		for (const entry of list) {
			const id = toSnowflakeString((entry as any)?.role_id);
			if (!id) continue;
			map[id] = {
				accept: normalizePermissionValue((entry as any)?.accept),
				deny: normalizePermissionValue((entry as any)?.deny)
			};
		}
		return map;
	}

        function collectMemberRoleIds(
                member: DtoMember | null | undefined,
                guildId: string | null
        ): string[] {
                const seen = new Set<string>();
                const result: string[] = [];

                for (const roleId of resolveMemberRoleIds(member ?? undefined)) {
                        if (seen.has(roleId)) continue;
                        seen.add(roleId);
                        result.push(roleId);
                }

                if (guildId && !seen.has(guildId)) {
                        seen.add(guildId);
                        result.push(guildId);
                }

                return result;
        }

	function resolveMemberRoleColor(
		member: DtoMember | null | undefined,
		guildId: string | null
	): string | null {
		const roleIds = collectMemberRoleIds(member, guildId);
		if (!roleIds.length) return null;

		const orderedRoleIds: string[] = [];
		const seen = new Set<string>();
		const appendUnique = (value: string | null | undefined) => {
			if (value == null) return;
			const normalized = String(value);
			if (!normalized || seen.has(normalized)) return;
			seen.add(normalized);
			orderedRoleIds.push(normalized);
		};

		for (const id of roleIds) {
			appendUnique(id);
		}
		appendUnique(guildId);

		for (const id of orderedRoleIds) {
			const role = roleMap[id];
			if (!role) continue;
			const rawColor = (role as any)?.color;
			if (rawColor == null) continue;
			return colorIntToHex(rawColor as number | string | bigint | null);
		}

		return null;
	}

	function aggregateRolePermissions(roleIds: Iterable<string>): number {
		let perms = 0;
		for (const id of roleIds) {
			const role = roleMap[id];
			if (!role) continue;
			perms |= normalizePermissionValue((role as any)?.permissions);
		}
		return perms;
	}

	function memberHasChannelAccess(
		member: DtoMember | null | undefined,
		channel: any,
		guild: any
	): boolean {
		if (!member || !channel) return false;
		const guildId =
			toSnowflakeString((channel as any)?.guild_id) ?? toSnowflakeString((guild as any)?.id);
		const roleIds = collectMemberRoleIds(member, guildId);
		const basePerms = aggregateRolePermissions(roleIds);
		const allowListedRoleIds = channelAllowListedRoleIds(guildId, channel, $channelRolesByGuild);

		return resolveMemberChannelAccess({
			member,
			channel,
			guild,
			guildId,
			roleIds,
			basePermissions: basePerms,
			channelOverrides,
			allowListedRoleIds,
			viewPermissionBit: VIEW_CHANNEL
		});
	}

	const currentGuild = $derived.by(() => {
		const gid = $selectedGuildId;
		if (!gid) return null;
		return $guilds.find((g) => toSnowflakeString((g as any)?.id) === gid) ?? null;
	});

	const currentChannel = $derived.by(() => {
		const gid = $selectedGuildId ?? '';
		const cid = $selectedChannelId ?? '';
		if (!gid || !cid) return null;
		const list = $channelsByGuild[gid] ?? [];
		return list.find((c: any) => String((c as any)?.id) === cid) ?? null;
	});

	const currentMembers = $derived.by(() => {
		const gid = $selectedGuildId ?? '';
		if (!gid) return [];
		const map = $membersByGuild;
		const loaded = map && Object.prototype.hasOwnProperty.call(map, gid) ? map[gid] : undefined;
		return (loaded ?? []) as DtoMember[];
	});

	$effect(() => {
		const gid = $selectedGuildId ?? '';
		if (!gid) {
			loadingMembers = false;
			membersError = null;
			return;
		}
		const map = $membersByGuild;
		if (map && Object.prototype.hasOwnProperty.call(map, gid)) {
			loadingMembers = false;
			membersError = null;
			return;
		}
		const token = ++membersLoadToken;
		loadingMembers = true;
		membersError = null;
		ensureGuildMembersLoaded(gid)
			.catch((err: any) => {
				if (token !== membersLoadToken) return;
				membersError = err?.response?.data?.message ?? err?.message ?? m.channel_members_error();
			})
			.finally(() => {
				if (token === membersLoadToken) {
					loadingMembers = false;
				}
			});
	});

	$effect(() => {
		const gid = $selectedGuildId ?? '';
		if (!gid) {
			roleMap = {};
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const roles = await loadGuildRolesCached(gid);
				if (!cancelled) {
					roleMap = buildRoleMap(roles);
				}
			} catch {
				if (!cancelled) {
					roleMap = {};
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const refreshToken = $channelOverridesRefreshToken;
		const gid = $selectedGuildId ?? '';
		const cid = $selectedChannelId ?? '';
		if (!gid || !cid) {
			channelOverrides = {};
			return;
		}
		const token = { id: ++overridesLoadToken, refreshToken };
		(async () => {
			try {
				const res = await auth.api.guildRoles.guildGuildIdChannelChannelIdRolesGet({
					guildId: toApiSnowflake(gid),
					channelId: toApiSnowflake(cid)
				});
				if (token.id !== overridesLoadToken || token.refreshToken !== $channelOverridesRefreshToken)
					return;
				const list = ((res as any)?.data ?? res ?? []) as GuildChannelRolePermission[];
				channelOverrides = resolveChannelOverrides(list);
			} catch {
				if (token.id !== overridesLoadToken || token.refreshToken !== $channelOverridesRefreshToken)
					return;
				channelOverrides = {};
			}
		})();
	});

	type DecoratedMember = {
		member: DtoMember;
		hasAccess: boolean;
		name: string;
		secondary: string;
		color: string | null;
	};

	const decoratedMembers = $derived.by(() => {
		const channel = currentChannel;
		const guild = currentGuild;
		const list = currentMembers ?? [];
		if (!channel) return [] as DecoratedMember[];
		const entries = list.map<DecoratedMember>((member) => {
			const hasAccess = memberHasChannelAccess(member, channel, guild);
			const guildId = toSnowflakeString((guild as any)?.id) ?? null;
			return {
				member,
				hasAccess,
				name: memberPrimaryName(member),
				secondary: memberSecondaryName(member),
				color: resolveMemberRoleColor(member, guildId)
			};
		});
		const hideWithoutAccess = Boolean((channel as any)?.private);
		const filtered = hideWithoutAccess ? entries.filter((entry) => entry.hasAccess) : entries;
		filtered.sort((a, b) => {
			if (a.hasAccess !== b.hasAccess) return a.hasAccess ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
		});
		return filtered;
	});

	const displayCount = $derived.by(() => decoratedMembers.length);
</script>

<div
	class="hidden min-h-0 w-64 flex-shrink-0 flex-col border-l border-[var(--stroke)] bg-[var(--panel)] xl:flex"
>
	<div
		class="flex h-[var(--header-h)] flex-shrink-0 items-center justify-between border-b border-[var(--stroke)] px-3"
	>
		<div class="text-sm font-semibold">{m.channel_members_title()}</div>
		<div class="text-xs text-[var(--muted)]">{displayCount}</div>
	</div>
	<div class="flex-1 overflow-y-auto">
		{#if !$selectedGuildId || !$selectedChannelId}
			<div class="px-4 py-6 text-sm text-[var(--muted)]">{m.channel_members_empty()}</div>
		{:else if loadingMembers}
			<div class="px-4 py-6 text-sm text-[var(--muted)]">{m.channel_members_loading()}</div>
		{:else if membersError}
			<div class="px-4 py-6 text-sm text-red-400">{membersError}</div>
		{:else if decoratedMembers.length === 0}
			<div class="px-4 py-6 text-sm text-[var(--muted)]">{m.channel_members_empty()}</div>
		{:else}
			<div class="space-y-1 py-2">
				{#each decoratedMembers as entry (toSnowflakeString((entry.member as any)?.user?.id) ?? memberPrimaryName(entry.member))}
					<div
						role="button"
						tabindex="0"
						class="flex items-center gap-3 px-3 py-2 text-sm"
						oncontextmenu={(event) =>
							openUserContextMenu(
								event,
								{ member: entry.member },
								{
									guildId: $selectedGuildId,
									channelId: $selectedChannelId
								}
							)}
					>
						<div
							class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--panel-strong)] text-xs font-semibold uppercase"
						>
							{memberInitial(entry.member)}
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate font-medium" style:color={entry.color ?? null}>
								{entry.name}
							</div>
							{#if entry.secondary}
								<div class="truncate text-xs text-[var(--muted)]">{entry.secondary}</div>
							{:else if !entry.hasAccess}
								<div class="text-xs text-[var(--muted)]">{m.channel_members_no_access()}</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
