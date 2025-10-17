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
        import {
                buildRoleMap,
                collectMemberRoleIds,
                memberInitial,
                memberPrimaryName,
                resolveMemberRoleColor,
                toSnowflakeString
        } from '$lib/utils/members';
        import { resolveAvatarUrl } from '$lib/utils/avatar';
        import {
                createPresenceSubscription,
                presenceByUser,
                presenceIndicatorClass,
                type PresenceStatus
        } from '$lib/stores/presence';
        import { memberProfilePanel } from '$lib/stores/memberProfilePanel';
        import { onDestroy } from 'svelte';

	const guilds = auth.guilds;
	const presenceMap = presenceByUser;
	const presenceSubscription = createPresenceSubscription();
	let lastTrackedUserIds: string[] = [];

	function applyTrackedUserIds(next: string[]) {
		if (
			next.length === lastTrackedUserIds.length &&
			next.every((id, index) => id === lastTrackedUserIds[index])
		) {
			return;
		}
		lastTrackedUserIds = next.slice();
		presenceSubscription.update(next);
	}

	onDestroy(() => {
		presenceSubscription.destroy();
	});

	let loadingMembers = $state(false);
	let membersError = $state<string | null>(null);
	let roleMap = $state<Record<string, DtoRole>>({});

        let membersLoadToken = 0;

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

        type PresenceBucket = 'online' | 'offline';

        type DecoratedMember = {
                member: DtoMember;
                hasAccess: boolean;
                name: string;
                color: string | null;
                userId: string | null;
                avatarUrl: string | null;
                presenceStatus: PresenceStatus | null;
                presenceSince: number | null;
                hasPresence: boolean;
                customStatusText: string | null;
                presenceBucket: PresenceBucket;
        };

        const decoratedMembers = $derived.by(() => {
                const channel = currentChannel;
                const guild = currentGuild;
		const list = currentMembers ?? [];
		if (!channel) {
			applyTrackedUserIds([]);
			return [] as DecoratedMember[];
		}
		const lookup = $presenceMap;
                const entries = list.map<DecoratedMember>((member) => {
                        const hasAccess = memberHasChannelAccess(member, channel, guild);
                        const guildId = toSnowflakeString((guild as any)?.id) ?? null;
                        const userId =
                                toSnowflakeString((member as any)?.user?.id) ?? toSnowflakeString((member as any)?.id);
                        const avatarUrl = resolveAvatarUrl(member, (member as any)?.user);
                        const info = userId ? (lookup[userId] ?? null) : null;
                        const presenceStatus = info?.status ?? null;
                        const hasPresence = Boolean(info);
                        const rawCustomStatus = info?.customStatusText;
                        const customStatusText =
                                typeof rawCustomStatus === 'string' && rawCustomStatus.trim().length > 0
                                        ? rawCustomStatus
                                        : null;
                        const presenceBucket: PresenceBucket =
                                hasPresence && presenceStatus && presenceStatus !== 'offline' ? 'online' : 'offline';
                        return {
                                member,
                                hasAccess,
                                name: memberPrimaryName(member),
                                color: resolveMemberRoleColor(member, guildId, roleMap),
                                userId,
                                avatarUrl,
                                presenceStatus,
                                presenceSince: info?.since ?? null,
                                hasPresence,
                                customStatusText,
                                presenceBucket
                        };
                });
                const hideWithoutAccess = Boolean((channel as any)?.private);
                const filtered = hideWithoutAccess ? entries.filter((entry) => entry.hasAccess) : entries;
                const tracked = filtered.map((entry) => entry.userId).filter((id): id is string => Boolean(id));
                applyTrackedUserIds(tracked);
                return filtered;
        });

        type MemberGroup = {
                id: PresenceBucket;
                members: DecoratedMember[];
        };

        function compareMemberEntries(a: DecoratedMember, b: DecoratedMember): number {
                if (a.hasAccess !== b.hasAccess) return a.hasAccess ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }

        const memberGroups = $derived.by(() => {
                const online: DecoratedMember[] = [];
                const offline: DecoratedMember[] = [];
                for (const entry of decoratedMembers) {
                        if (entry.presenceBucket === 'online') {
                                online.push(entry);
                        } else {
                                offline.push(entry);
                        }
                }
                online.sort(compareMemberEntries);
                offline.sort(compareMemberEntries);
                return [
                        { id: 'online', members: online },
                        { id: 'offline', members: offline }
                ] satisfies MemberGroup[];
        });

        function openMemberPanel(event: MouseEvent, entry: DecoratedMember) {
                const target = event.currentTarget as HTMLElement | null;
                let anchor: { x: number; y: number; width: number; height: number } | null = null;
                if (target && typeof window !== 'undefined') {
                        const rect = target.getBoundingClientRect();
                        anchor = {
                                x: rect.left,
                                y: rect.top,
                                width: rect.width,
                                height: rect.height
                        };
                }

                memberProfilePanel.open({
                        member: entry.member,
                        user: (entry.member as any)?.user ?? null,
                        guildId: $selectedGuildId,
                        anchor
                });
        }

        $effect(() => {
                const panelState = $memberProfilePanel;
                const gid = $selectedGuildId;
                if (panelState.open && panelState.guildId && panelState.guildId !== gid) {
                        memberProfilePanel.close();
                }
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
                        <div class="space-y-4 py-2">
                                {#each memberGroups as group (group.id)}
                                        {#if group.members.length}
                                                <div class="space-y-1">
                                                        <div class="px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                                                {group.id === 'online'
                                                                        ? m.channel_members_group_online({ count: group.members.length })
                                                                        : m.channel_members_group_offline({ count: group.members.length })}
                                                        </div>
                                                        {#each group.members as entry (toSnowflakeString((entry.member as any)?.user?.id) ?? memberPrimaryName(entry.member))}
                                                                <button
                                                                        type="button"
                                                                        class="group/member flex w-full select-none items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition hover:bg-[var(--panel-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                                                                        onclick={(event) => openMemberPanel(event, entry)}
                                                                        oncontextmenu={(event) =>
                                                                                openUserContextMenu(
                                                                                        event,
                                                                                        { member: entry.member },
                                                                                        {
                                                                                                guildId: $selectedGuildId,
                                                                                                channelId: $selectedChannelId
                                                                                        }
                                                                                )}
                                                                        data-tooltip-disabled
                                                                >
                                                                        <div class="relative h-8 w-8 flex-shrink-0">
                                                                                <div
                                                                                        class="grid h-full w-full place-items-center overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-xs font-semibold uppercase"
                                                                                >
                                                                                        {#if entry.avatarUrl}
                                                                                                <img
                                                                                                        alt=""
                                                                                                        aria-hidden="true"
                                                                                                        class="h-full w-full object-cover"
                                                                                                        src={entry.avatarUrl}
                                                                                                />
                                                                                        {:else}
                                                                                                {memberInitial(entry.member)}
                                                                                        {/if}
                                                                                </div>
                                                                                <span
                                                                                        class={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${presenceIndicatorClass(entry.presenceStatus)}`}
                                                                                        class:opacity-0={!entry.hasPresence}
                                                                                ></span>
                                                                        </div>
                                                                        <div class="min-w-0 flex-1">
                                                                                <div class="truncate font-medium" style:color={entry.color ?? null}>
                                                                                        {entry.name}
                                                                                </div>
                                                                                {#if entry.customStatusText}
                                                                                        <div class="truncate text-xs text-[var(--muted)]">{entry.customStatusText}</div>
                                                                                {/if}
                                                                                {#if !entry.hasAccess}
                                                                                        <div class="text-xs text-[var(--muted)]">{m.channel_members_no_access()}</div>
                                                                                {/if}
                                                                        </div>
                                                                </button>
                                                        {/each}
                                                </div>
                                        {/if}
                                {/each}
                        </div>
                {/if}
        </div>
</div>
