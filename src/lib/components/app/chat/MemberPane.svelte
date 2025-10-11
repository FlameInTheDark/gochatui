<script lang="ts">
	import type { DtoMember, DtoRole } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import {
		channelsByGuild,
		channelRolesByGuild,
		membersByGuild,
		selectedChannelId,
		selectedGuildId
	} from '$lib/stores/appState';
	import { colorIntToHex } from '$lib/utils/color';
	import { guildRoleCacheState, loadGuildRolesCached } from '$lib/utils/guildRoles';
	import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
	import { m } from '$lib/paraglide/messages.js';
	import { openUserContextMenu } from '$lib/utils/userContextMenu';
	import { channelAllowListedRoleIds } from '$lib/utils/channelRoles';
	import {
		memberHasChannelAccess as resolveMemberChannelAccess,
		describeMemberChannelAccess as describeMemberChannelAccessDev,
		type MemberChannelAccessDescription
	} from '$lib/utils/memberChannelAccess';
	import { collectMemberRoleIds as baseCollectMemberRoleIds } from '$lib/utils/currentUserRoleIds';
	import {
		createPresenceSubscription,
		presenceByUser,
		presenceIndicatorClass,
		type PresenceStatus
	} from '$lib/stores/presence';
	import { onDestroy } from 'svelte';

	const guilds = auth.guilds;
	const presenceMap = presenceByUser;
	const presenceSubscription = createPresenceSubscription();

	onDestroy(() => {
		presenceSubscription.destroy();
	});

	let loadingMembers = $state(false);
	let membersError = $state<string | null>(null);
	let roleMap = $state<Record<string, DtoRole>>({});

	let membersLoadToken = 0;

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

	function collectMemberRoleIds(
		member: DtoMember | null | undefined,
		guildId: string | null
	): string[] {
		const seen = new Set<string>();
		const result: string[] = [];

		const rawRoles = Array.isArray((member as any)?.roles) ? (member as any).roles : [];
		for (const entry of rawRoles) {
			const nestedId = toSnowflakeString((entry as any)?.role?.id);
			if (!nestedId || seen.has(nestedId)) continue;
			seen.add(nestedId);
			result.push(nestedId);
		}

		for (const roleId of baseCollectMemberRoleIds(member ?? undefined)) {
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

	const describeMemberChannelAccess = import.meta.env.DEV
		? describeMemberChannelAccessDev
		: undefined;

	function describeMemberAccess(
		member: DtoMember | null | undefined,
		channel: any,
		guild: any
	): MemberChannelAccessDescription | null {
		if (!describeMemberChannelAccess || !member || !channel) return null;
		const guildId =
			toSnowflakeString((channel as any)?.guild_id) ?? toSnowflakeString((guild as any)?.id);
		const memberRoleIds = collectMemberRoleIds(member, guildId);
		const channelRoleIds = channelAllowListedRoleIds(guildId, channel, $channelRolesByGuild);

		return describeMemberChannelAccess({
			member,
			channel,
			guild,
			guildId,
			memberRoleIds,
			channelRoleIds
		});
	}

	function memberHasChannelAccess(
		member: DtoMember | null | undefined,
		channel: any,
		guild: any
	): boolean {
		if (!member || !channel) return false;
		const guildId =
			toSnowflakeString((channel as any)?.guild_id) ?? toSnowflakeString((guild as any)?.id);
		const memberRoleIds = collectMemberRoleIds(member, guildId);
		const channelRoleIds = channelAllowListedRoleIds(guildId, channel, $channelRolesByGuild);

		return resolveMemberChannelAccess({
			member,
			channel,
			guild,
			guildId,
			memberRoleIds,
			channelRoleIds
		});
	}

	if (import.meta.env.DEV) {
		let debugLogEnabled = $state(false);

		const ensureDebugBridge = () => {
			if (!describeMemberChannelAccess || typeof window === 'undefined') return null;
			const w = window as any;
			const root = (w.__gochatuiDebug = w.__gochatuiDebug ?? {});
			const memberDebug = (root.memberAccess = root.memberAccess ?? {});

			let internalLog = Boolean(memberDebug.log);
			if (!memberDebug.__configured) {
				Object.defineProperty(memberDebug, 'log', {
					configurable: true,
					enumerable: true,
					get() {
						return internalLog;
					},
					set(value: any) {
						const next = Boolean(value);
						if (internalLog !== next) {
							internalLog = next;
							debugLogEnabled = next;
						}
					}
				});
				memberDebug.__configured = true;
				memberDebug.log = internalLog;
			} else {
				debugLogEnabled = internalLog;
			}

			memberDebug.describe = (rawMember: unknown) => {
				const normalizedId =
					typeof rawMember === 'object' && rawMember
						? toSnowflakeString((rawMember as any)?.user?.id ?? (rawMember as any)?.id)
						: toSnowflakeString(rawMember);
				const channel = currentChannel;
				const guild = currentGuild;
				const members = currentMembers ?? [];
				const memberEntry =
					members.find(
						(candidate) => toSnowflakeString((candidate as any)?.user?.id) === normalizedId
					) ?? null;
				const description =
					memberEntry && channel ? describeMemberAccess(memberEntry, channel, guild) : null;

				console.groupCollapsed('[memberAccess.describe]', {
					channelId: channel ? toSnowflakeString((channel as any)?.id) : null,
					memberId: normalizedId
				});
				if (description) {
					console.log(description);
				} else {
					console.warn('No member/channel found for inspection');
				}
				console.groupEnd();
				return description;
			};

			return memberDebug;
		};

		$effect(() => {
			const debug = ensureDebugBridge();
			if (!debug || !debugLogEnabled) {
				return;
			}
			const channel = currentChannel;
			if (!channel) return;
			const guild = currentGuild;
			const channelId = toSnowflakeString((channel as any)?.id);
			const members = currentMembers ?? [];
			for (const member of members) {
				const description = describeMemberAccess(member, channel, guild);
				if (!description) continue;
				console.debug('[memberAccess.log]', {
					channelId,
					memberId: description.memberId,
					finalAllowed: description.finalAllowed,
					privateGateAllows: description.privateGateAllows,
					channelRoleIds: description.channelRoleIds,
					intersectingRoleIds: description.intersectingRoleIds
				});
			}
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
		const guildRoleCacheTick = $guildRoleCacheState;
		void guildRoleCacheTick;
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

	type DecoratedMember = {
		member: DtoMember;
		hasAccess: boolean;
		name: string;
		secondary: string;
		color: string | null;
		userId: string | null;
		presenceStatus: PresenceStatus | null;
		presenceSince: number | null;
		hasPresence: boolean;
	};

	const decoratedMembers = $derived.by(() => {
		const channel = currentChannel;
		const guild = currentGuild;
		const list = currentMembers ?? [];
		if (!channel) {
			presenceSubscription.update([]);
			return [] as DecoratedMember[];
		}
		const lookup = $presenceMap;
		const entries = list.map<DecoratedMember>((member) => {
			const hasAccess = memberHasChannelAccess(member, channel, guild);
			const guildId = toSnowflakeString((guild as any)?.id) ?? null;
			const userId =
				toSnowflakeString((member as any)?.user?.id) ?? toSnowflakeString((member as any)?.id);
			const info = userId ? (lookup[userId] ?? null) : null;
			return {
				member,
				hasAccess,
				name: memberPrimaryName(member),
				secondary: memberSecondaryName(member),
				color: resolveMemberRoleColor(member, guildId),
				userId,
				presenceStatus: info?.status ?? null,
				presenceSince: info?.since ?? null,
				hasPresence: Boolean(info)
			};
		});
		const hideWithoutAccess = Boolean((channel as any)?.private);
		const filtered = hideWithoutAccess ? entries.filter((entry) => entry.hasAccess) : entries;
		const tracked = filtered.map((entry) => entry.userId).filter((id): id is string => Boolean(id));
		presenceSubscription.update(tracked);
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
						<div class="relative h-8 w-8 flex-shrink-0">
							<div
								class="flex h-full w-full items-center justify-center rounded-full bg-[var(--panel-strong)] text-xs font-semibold uppercase"
							>
								{memberInitial(entry.member)}
							</div>
							<span
								class={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${presenceIndicatorClass(entry.presenceStatus)}`}
								class:opacity-0={!entry.hasPresence}
							/>
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
