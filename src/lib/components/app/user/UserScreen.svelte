<script lang="ts">
	import { onMount } from 'svelte';
	import type { DtoChannel, DtoUser } from '$lib/api';
	import { m } from '$lib/paraglide/messages.js';
        import { auth } from '$lib/stores/auth';
        import { channelsByGuild } from '$lib/stores/appState';
        import { appSettings, addVisibleDmChannel } from '$lib/stores/settings';
	import UserPanel from '$lib/components/app/user/UserPanel.svelte';

	type FriendEntry = {
		id: string;
		name: string;
		discriminator: string | null;
	};

	type DirectChannelEntry = {
		id: string;
		label: string;
		recipients: FriendEntry[];
	};

	type FriendRequestDirection = 'incoming' | 'outgoing' | 'unknown';

	type FriendRequestEntry = FriendEntry & {
		direction: FriendRequestDirection;
	};

	const user = auth.user;
        const channelStore = channelsByGuild;
        const settingsStore = appSettings;
	const api = auth.api;

	let directChannels: DirectChannelEntry[] = [];
	let apiFriendList: any[] = [];
	let apiFriendRequests: any[] = [];
	let friends: FriendEntry[] = [];
        let friendRequests: FriendRequestEntry[] = [];
        let dmChannelError: string | null = null;
        let activeList: 'friends' | 'requests' = 'friends';
        let showAddFriendModal = false;
	let addFriendIdentifier = '';
	let friendActionError: string | null = null;
	let isSubmittingAddFriend = false;
        let addFriendError: string | null = null;
        let removingFriendIds = new Set<string>();
        let processingRequestIds = new Set<string>();
        let openingDmChannelIds = new Set<string>();

	function toSnowflakeString(value: unknown): string | null {
		if (value == null) return null;
		try {
			if (typeof value === 'string') return value;
			if (typeof value === 'number' || typeof value === 'bigint') {
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

	function toSnowflakeBigInt(value: string | null | undefined): bigint | null {
		if (!value) return null;
		try {
			return BigInt(value);
		} catch {
			return null;
		}
	}

	function setFriendLoading(id: string, value: boolean) {
		const next = new Set(removingFriendIds);
		if (value) {
			next.add(id);
		} else {
			next.delete(id);
		}
		removingFriendIds = next;
	}

        function setRequestLoading(id: string, value: boolean) {
                const next = new Set(processingRequestIds);
                if (value) {
                        next.add(id);
                } else {
                        next.delete(id);
                }
                processingRequestIds = next;
        }

        function setDmChannelLoading(id: string, value: boolean) {
                const next = new Set(openingDmChannelIds);
                if (value) {
                        next.add(id);
                } else {
                        next.delete(id);
                }
                openingDmChannelIds = next;
        }

	async function refreshFriendData(syncUser = false, clearError = false) {
		if (clearError) {
			friendActionError = null;
		}
		const [friendsResult, requestsResult] = await Promise.allSettled([
			api.user.userMeFriendsGet(),
			api.user.userMeFriendsRequestsGet()
		]);
		let encounteredError = false;
		if (friendsResult.status === 'fulfilled') {
			const data = friendsResult.value?.data;
			apiFriendList = Array.isArray(data) ? data : [];
		} else {
			encounteredError = true;
		}
		if (requestsResult.status === 'fulfilled') {
			const data = requestsResult.value?.data;
			apiFriendRequests = Array.isArray(data) ? data : [];
		} else {
			encounteredError = true;
		}
		if (encounteredError && !friendActionError) {
			friendActionError = m.user_home_friend_action_error();
		} else if (!encounteredError && clearError) {
			friendActionError = null;
		}
		if (syncUser) {
			try {
				await auth.loadMe();
			} catch {
				/* ignore */
			}
		}
	}

	async function handleRemoveFriend(id: string) {
		const snowflake = toSnowflakeBigInt(id);
		if (!snowflake) {
			friendActionError = m.user_home_friend_action_error();
			return;
		}
		setFriendLoading(id, true);
		try {
			await api.user.userMeFriendsDelete({
				userUnfriendRequest: { user_id: snowflake as any }
			});
			await refreshFriendData(true, true);
		} catch (error) {
			console.error('Failed to remove friend', error);
			friendActionError = m.user_home_friend_action_error();
		} finally {
			setFriendLoading(id, false);
		}
	}

        async function handleFriendRequest(id: string, action: 'accept' | 'decline') {
                const snowflake = toSnowflakeBigInt(id);
                if (!snowflake) {
                        friendActionError = m.user_home_friend_action_error();
                        return;
		}
		setRequestLoading(id, true);
		try {
			if (action === 'accept') {
				await api.user.userMeFriendsRequestsPost({
					userFriendRequestAction: { user_id: snowflake as any }
				});
			} else {
				await api.user.userMeFriendsRequestsDelete({
					userFriendRequestAction: { user_id: snowflake as any }
				});
			}
			await refreshFriendData(true, true);
		} catch (error) {
			console.error('Failed to process friend request', error);
			friendActionError = m.user_home_friend_action_error();
		} finally {
			setRequestLoading(id, false);
                }
        }

        async function handleOpenDirectChannel(id: string) {
                const snowflake = toSnowflakeBigInt(id);
                if (!snowflake) {
                        dmChannelError = m.user_home_friend_action_error();
                        return;
                }
                if (openingDmChannelIds.has(id)) return;
                setDmChannelLoading(id, true);
                dmChannelError = null;
                try {
                        const response = await api.user.userMeFriendsUserIdGet({
                                userId: snowflake as any
                        });
                        const channel = response.data ?? null;
                        const channelId = toSnowflakeString((channel as any)?.id);
                        if (!channel || !channelId) {
                                throw new Error('Invalid DM channel response');
                        }
                        const normalized = normalizeDtoChannel(channel) as DtoChannel;
                        channelsByGuild.update((map) => {
                                const dmKey = '@me';
                                const existing = Array.isArray(map[dmKey]) ? map[dmKey] : [];
                                const filtered = existing.filter(
                                        (entry) => toSnowflakeString((entry as any)?.id) !== channelId
                                );
                                return {
                                        ...map,
                                        [dmKey]: [...filtered, normalized]
                                };
                        });
                        addVisibleDmChannel(channelId, id);
                } catch (error) {
                        console.error('Failed to open DM channel', error);
                        dmChannelError = m.user_home_friend_action_error();
                } finally {
                        setDmChannelLoading(id, false);
                }
        }

	onMount(() => {
		void refreshFriendData(false, true);
	});

	function extractUserCandidate(candidate: any): DtoUser | null {
		if (!candidate) return null;
		if (candidate.user) return candidate.user as DtoUser;
		if (candidate.member?.user) return candidate.member.user as DtoUser;
		if (candidate.profile?.user) return candidate.profile.user as DtoUser;
		if (candidate.profile) return candidate.profile as DtoUser;
		if (candidate.target) return candidate.target as DtoUser;
		return candidate as DtoUser;
	}

	function normalizeFriendEntry(value: any, fallbackName: string): FriendEntry | null {
		const base = extractUserCandidate(value);
		if (!base) return null;
		const id =
			toSnowflakeString((base as any)?.id) ??
			toSnowflakeString((value as any)?.user_id) ??
			toSnowflakeString((value as any)?.userId);
		if (!id) return null;
		const nameSource =
			(base as any)?.name ??
			(base as any)?.username ??
			(base as any)?.display_name ??
			(value as any)?.name ??
			(value as any)?.username ??
			(value as any)?.display_name;
		const name =
			typeof nameSource === 'string' && nameSource.trim() ? nameSource.trim() : fallbackName;
		const discSource =
			(base as any)?.discriminator ??
			(base as any)?.tag ??
			(value as any)?.discriminator ??
			(value as any)?.tag;
		const discriminator =
			typeof discSource === 'string' && discSource.trim() ? discSource.trim() : null;
		return { id, name, discriminator };
	}

	function normalizeDirectChannel(
		raw: any,
		selfId: string | null,
		fallbackName: string
	): DirectChannelEntry | null {
		if (!raw) return null;
		const id =
			toSnowflakeString(raw?.id) ??
			toSnowflakeString(raw?.channel_id) ??
			toSnowflakeString(raw?.channelId);
		if (!id) return null;
		const recipientsRaw = Array.isArray(raw?.recipients)
			? raw.recipients
			: Array.isArray(raw?.users)
				? raw.users
				: Array.isArray(raw?.members)
					? raw.members
					: Array.isArray(raw?.participants)
						? raw.participants
						: [];
		const recipients: FriendEntry[] = [];
		for (const candidate of recipientsRaw) {
			const normalized = normalizeFriendEntry(candidate, fallbackName);
			if (!normalized) continue;
			if (selfId && normalized.id === selfId) continue;
			recipients.push(normalized);
		}
		const nameFields = [raw?.name, raw?.topic, raw?.label];
		let label = '';
		for (const field of nameFields) {
			if (typeof field === 'string' && field.trim()) {
				label = field.trim();
				break;
			}
		}
		if (!label && recipients.length) {
			label = recipients.map((entry) => entry.name).join(', ');
		}
		if (!label) {
			label = `Channel ${id}`;
		}
		return { id, label, recipients };
	}

	function normalizeDtoChannel(raw: DtoChannel | any): any {
		if (!raw) return raw;
		if ((raw as any)?.recipients) return raw;
		if ((raw as any)?.users) return raw;
		if ((raw as any)?.members) return raw;
		const recipients = (raw as any)?.recipient_ids;
		if (Array.isArray(recipients)) {
			return {
				...raw,
				recipients
			};
		}
		return raw;
	}

	function classifyRelationship(
		source: any,
		selfId: string | null
	): 'friend' | 'incoming_request' | 'outgoing_request' | 'blocked' | 'unknown' {
		const rawType =
			source?.relationship_type ??
			source?.relationshipType ??
			source?.type ??
			source?.status ??
			source?.state ??
			source?.kind ??
			null;

		const normalizeNumericType = (value: number) => {
			switch (value) {
				case 1:
					return 'friend';
				case 2:
					return 'blocked';
				case 3:
					return 'incoming_request';
				case 4:
					return 'outgoing_request';
				default:
					return 'unknown';
			}
		};

		if (typeof rawType === 'number') {
			return normalizeNumericType(rawType);
		}

		if (typeof rawType === 'string') {
			const lowered = rawType.toLowerCase();
			if (['friend', 'friends', 'accepted', 'mutual'].includes(lowered)) {
				return 'friend';
			}
			if (
				[
					'incoming',
					'inbound',
					'pending_incoming',
					'pending_in',
					'request_in',
					'pending_received'
				].includes(lowered)
			) {
				return 'incoming_request';
			}
			if (
				[
					'outgoing',
					'outbound',
					'pending_outgoing',
					'pending_out',
					'request_out',
					'pending_sent'
				].includes(lowered)
			) {
				return 'outgoing_request';
			}
			if (['blocked', 'block', 'ignored'].includes(lowered)) {
				return 'blocked';
			}
		}

		const directionField = source?.direction ?? source?.request_direction;
		if (typeof directionField === 'string') {
			const lowered = directionField.toLowerCase();
			if (['incoming', 'inbound', 'received'].includes(lowered)) {
				return 'incoming_request';
			}
			if (['outgoing', 'outbound', 'sent'].includes(lowered)) {
				return 'outgoing_request';
			}
		}

		const incomingLike =
			source?.incoming ??
			source?.is_incoming ??
			source?.incoming_request ??
			source?.is_received ??
			null;
		const outgoingLike =
			source?.outgoing ??
			source?.is_outgoing ??
			source?.outgoing_request ??
			source?.is_sent ??
			null;

		if (incomingLike === true && outgoingLike !== true) {
			return 'incoming_request';
		}
		if (outgoingLike === true && incomingLike !== true) {
			return 'outgoing_request';
		}

		const pendingLike = source?.pending ?? source?.is_pending ?? source?.request ?? null;
		if (pendingLike === true) {
			const initiatorId = toSnowflakeString(
				source?.initiator_id ?? source?.initiatorId ?? source?.sender_id
			);
			const recipientId = toSnowflakeString(
				source?.recipient_id ?? source?.recipientId ?? source?.target_id
			);
			if (selfId) {
				if (initiatorId && initiatorId === selfId) {
					return 'outgoing_request';
				}
				if (recipientId && recipientId === selfId) {
					return 'incoming_request';
				}
			}
			return 'unknown';
		}

		const initiatorId = toSnowflakeString(
			source?.initiator_id ?? source?.initiatorId ?? source?.sender_id
		);
		const recipientId = toSnowflakeString(
			source?.recipient_id ?? source?.recipientId ?? source?.target_id
		);
		if (selfId) {
			if (initiatorId && initiatorId === selfId) {
				return 'outgoing_request';
			}
			if (recipientId && recipientId === selfId) {
				return 'incoming_request';
			}
		}

		return 'unknown';
	}

	function resolveRequestDirection(
		source: any,
		selfId: string | null,
		fallback: FriendRequestDirection
	): FriendRequestDirection {
		const classified = classifyRelationship(source, selfId);
		if (classified === 'incoming_request') return 'incoming';
		if (classified === 'outgoing_request') return 'outgoing';

		const directionField = source?.direction ?? source?.request_direction;
		if (typeof directionField === 'string') {
			const lowered = directionField.toLowerCase();
			if (['incoming', 'inbound', 'received'].includes(lowered)) {
				return 'incoming';
			}
			if (['outgoing', 'outbound', 'sent'].includes(lowered)) {
				return 'outgoing';
			}
		}

		const incomingLike =
			source?.incoming ??
			source?.is_incoming ??
			source?.incoming_request ??
			source?.is_received ??
			null;
		const outgoingLike =
			source?.outgoing ??
			source?.is_outgoing ??
			source?.outgoing_request ??
			source?.is_sent ??
			null;

		if (incomingLike === true && outgoingLike !== true) {
			return 'incoming';
		}
		if (outgoingLike === true && incomingLike !== true) {
			return 'outgoing';
		}

		const initiatorId = toSnowflakeString(
			source?.initiator_id ?? source?.initiatorId ?? source?.sender_id
		);
		const recipientId = toSnowflakeString(
			source?.recipient_id ?? source?.recipientId ?? source?.target_id
		);
		if (selfId) {
			if (initiatorId && initiatorId === selfId) {
				return 'outgoing';
			}
			if (recipientId && recipientId === selfId) {
				return 'incoming';
			}
		}

		return fallback;
	}

	$: {
		const meId = toSnowflakeString(($user as any)?.id);
		const fallbackName = m.user_default_name();
                const sources: any[] = [];
                const userData = $user as any;
                const dmVisibility = new Set($settingsStore.dmChannels.map((entry) => entry.channelId));
                const restrictToVisible = dmVisibility.size > 0;
                const candidateFields = ['dm_channels', 'direct_channels', 'directs', 'channels'];
                for (const field of candidateFields) {
                        const value = userData?.[field];
                        if (Array.isArray(value)) {
                                sources.push(...value);
			}
		}
		const map = $channelStore as Record<string, DtoChannel[]> | undefined;
		if (map && typeof map === 'object') {
			for (const list of Object.values(map)) {
				if (!Array.isArray(list)) continue;
				for (const channel of list) {
					const raw: any = normalizeDtoChannel(channel);
					const type = (raw as any)?.type ?? null;
					const guildId =
						(raw as any)?.guild_id ?? (raw as any)?.guildId ?? (raw as any)?.guild ?? null;
					if (guildId == null || type === 1 || type === 3) {
						sources.push(raw);
					}
				}
			}
		}
		const seen = new Set<string>();
		const result: DirectChannelEntry[] = [];
		for (const source of sources) {
			const normalized = normalizeDirectChannel(source, meId, fallbackName);
                        if (!normalized) continue;
                        if (restrictToVisible && !dmVisibility.has(normalized.id)) continue;
                        if (seen.has(normalized.id)) continue;
                        seen.add(normalized.id);
                        result.push(normalized);
                }
                result.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
		directChannels = result;
	}

	$: {
		const fallbackName = m.user_default_name();
		const meId = toSnowflakeString(($user as any)?.id);
		const userData = $user as any;
		const friendSources = [
			apiFriendList,
			userData?.friends,
			userData?.friend_list,
			userData?.relationships,
			userData?.relationship_list
		];
		const friendMap = new Map<string, FriendEntry>();
		const requestMap = new Map<string, FriendRequestEntry>();
		const requestCollections: Array<{
			list: any;
			direction: FriendRequestDirection;
		}> = [
			{ list: apiFriendRequests, direction: 'unknown' },
			{ list: userData?.friend_requests, direction: 'unknown' },
			{ list: userData?.pending_requests, direction: 'unknown' },
			{ list: userData?.pending_friends, direction: 'unknown' },
			{ list: userData?.pending, direction: 'unknown' },
			{ list: userData?.incoming_requests, direction: 'incoming' },
			{ list: userData?.outgoing_requests, direction: 'outgoing' }
		];

		const addFriend = (entry: FriendEntry) => {
			if (!friendMap.has(entry.id)) {
				friendMap.set(entry.id, entry);
			}
		};

		const addRequest = (entry: FriendRequestEntry) => {
			if (!requestMap.has(entry.id)) {
				requestMap.set(entry.id, entry);
			}
		};

		for (const source of friendSources) {
			if (!Array.isArray(source)) continue;
			for (const entry of source) {
				const normalized = normalizeFriendEntry(entry, fallbackName);
				if (!normalized) continue;
				if (meId && normalized.id === meId) continue;
				const relation = classifyRelationship(entry, meId);
				if (relation === 'friend') {
					addFriend(normalized);
				} else if (relation === 'incoming_request' || relation === 'outgoing_request') {
					addRequest({
						...normalized,
						direction: relation === 'incoming_request' ? 'incoming' : 'outgoing'
					});
				} else if (!friendMap.has(normalized.id)) {
					addFriend(normalized);
				}
			}
		}

		for (const descriptor of requestCollections) {
			const list = descriptor.list;
			if (!Array.isArray(list)) continue;
			for (const entry of list) {
				const normalized = normalizeFriendEntry(entry, fallbackName);
				if (!normalized) continue;
				if (meId && normalized.id === meId) continue;
				const direction = resolveRequestDirection(entry, meId, descriptor.direction);
				addRequest({
					...normalized,
					direction
				});
			}
		}

		for (const channel of directChannels) {
			for (const recipient of channel.recipients) {
				if (meId && recipient.id === meId) continue;
				addFriend(recipient);
			}
		}

		for (const id of friendMap.keys()) {
			requestMap.delete(id);
		}

		friends = Array.from(friendMap.values()).sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
		);

		const directionRank: Record<FriendRequestDirection, number> = {
			incoming: 0,
			outgoing: 1,
			unknown: 2
		};

		friendRequests = Array.from(requestMap.values()).sort((a, b) => {
			const dirDelta = directionRank[a.direction] - directionRank[b.direction];
			if (dirDelta !== 0) return dirDelta;
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
		});
	}

	function initialsFor(name: string): string {
		if (!name) return '';
		const trimmed = name.trim();
		if (!trimmed) return '';
		return trimmed.slice(0, 2).toUpperCase();
	}

	function openAddFriendModal() {
		addFriendIdentifier = '';
		addFriendError = null;
		showAddFriendModal = true;
	}

	function closeAddFriendModal() {
		if (isSubmittingAddFriend) return;
		addFriendError = null;
		showAddFriendModal = false;
	}

	async function handleAddFriendSubmit() {
		addFriendError = null;
		const identifier = addFriendIdentifier.trim();
		if (!identifier) {
			addFriendError = m.user_home_add_friend_required();
			return;
		}
		isSubmittingAddFriend = true;
		let succeeded = false;
		try {
			await api.user.userMeFriendsPost({
				userCreateFriendRequestRequest: { discriminator: identifier }
			});
			await refreshFriendData(true, true);
			addFriendIdentifier = '';
			activeList = 'requests';
			succeeded = true;
		} catch (error) {
			console.error('Failed to send friend request', error);
			addFriendError = m.user_home_add_friend_error();
		} finally {
			isSubmittingAddFriend = false;
			if (succeeded) {
				closeAddFriendModal();
			}
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!showAddFriendModal) return;
		if (isSubmittingAddFriend) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeAddFriendModal();
		}
	}
</script>

<div class="col-span-2 flex h-full min-h-0 flex-col overflow-hidden">
	<div
		class="flex h-[var(--header-h)] flex-shrink-0 items-center gap-3 border-b border-[var(--stroke)] px-5"
	>
		<h1 class="text-base font-semibold">{m.user_home_header()}</h1>
		<button
			type="button"
			class="ml-auto rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-[var(--bg)] transition hover:bg-[var(--brand-strong)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:outline-none"
			on:click={openAddFriendModal}
		>
			{m.user_home_add_friend()}
		</button>
	</div>
	<div class="flex min-h-0 flex-1 overflow-hidden">
		<section
			class="flex h-full min-h-0 w-[var(--col2)] flex-shrink-0 flex-col overflow-hidden border-r border-[var(--stroke)]"
		>
			<div class="flex flex-col gap-3 border-b border-[var(--stroke)] px-4 py-3">
				<div class="flex flex-col gap-1">
					<button
						type="button"
						class={`flex w-full items-center rounded px-2 py-1 text-left text-sm font-medium transition-colors hover:bg-[var(--panel)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:outline-none ${
							activeList === 'friends'
								? 'bg-[var(--panel)] text-[var(--text-strong)]'
								: 'text-[var(--muted)] hover:text-[var(--text)]'
						}`}
						aria-pressed={activeList === 'friends'}
						on:click={() => (activeList = 'friends')}
					>
						<span class="truncate">{m.user_home_tab_friends()}</span>
					</button>
					<button
						type="button"
						class={`flex w-full items-center rounded px-2 py-1 text-left text-sm font-medium transition-colors hover:bg-[var(--panel)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:outline-none ${
							activeList === 'requests'
								? 'bg-[var(--panel)] text-[var(--text-strong)]'
								: 'text-[var(--muted)] hover:text-[var(--text)]'
						}`}
						aria-pressed={activeList === 'requests'}
						on:click={() => (activeList = 'requests')}
					>
						<span class="truncate">{m.user_home_tab_requests()}</span>
					</button>
				</div>
			</div>
			<div class="flex min-h-0 flex-1 flex-col">
                                <div class="flex-1 overflow-y-auto px-3 py-3">
                                        {#if dmChannelError}
                                                <p class="mb-2 px-1 text-sm text-[var(--danger)]">{dmChannelError}</p>
                                        {/if}
                                        {#if directChannels.length > 0}
                                                <ul class="space-y-2">
                                                        {#each directChannels as channel (channel.id)}
								<li>
                                                        <div
                                                                class={`flex items-center gap-3 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 transition ${
                                                                        openingDmChannelIds.has(friend.id)
                                                                                ? 'cursor-wait opacity-70'
                                                                                : 'cursor-pointer hover:border-[var(--brand)]/40 hover:bg-[var(--panel)]'
                                                                }`}
                                                                role="button"
                                                                tabindex="0"
                                                                aria-disabled={openingDmChannelIds.has(friend.id)}
                                                                aria-busy={openingDmChannelIds.has(friend.id)}
                                                                on:click={() => handleOpenDirectChannel(friend.id)}
                                                                on:keydown={(event) => {
                                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                                                event.preventDefault();
                                                                                handleOpenDirectChannel(friend.id);
                                                                        }
                                                                }}
                                                        >
										<div class="min-w-0 flex-1">
											<div class="truncate text-sm font-medium">{channel.label}</div>
											{#if channel.recipients.length}
												<div class="truncate text-xs text-[var(--muted)]">
													{channel.recipients.map((entry) => entry.name).join(', ')}
												</div>
											{/if}
										</div>
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="px-1 text-sm text-[var(--muted)]">{m.user_home_dms_empty()}</p>
					{/if}
				</div>
				<UserPanel />
			</div>
		</section>
		<section class="flex flex-1 flex-col overflow-y-auto px-6 py-4">
			<h2 class="mb-4 text-lg font-semibold">
				{#if activeList === 'friends'}
					{m.user_home_friends_heading()}
				{:else}
					{m.user_home_requests_heading()}
				{/if}
			</h2>
			{#if friendActionError}
				<p class="mb-3 text-sm text-[var(--danger)]">{friendActionError}</p>
			{/if}
			{#if activeList === 'friends'}
				{#if friends.length > 0}
					<div class="grid gap-3">
						{#each friends as friend (friend.id)}
							<div
								class="flex items-center gap-3 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
							>
								<div
									class="grid h-10 w-10 place-items-center rounded-full bg-[var(--panel)] text-sm font-semibold"
								>
									{initialsFor(friend.name)}
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm font-semibold">{friend.name}</div>
									{#if friend.discriminator}
										<div class="truncate text-xs text-[var(--muted)]">#{friend.discriminator}</div>
									{/if}
								</div>
								<div class="ml-auto flex items-center gap-2">
                                                                        <button
                                                                                type="button"
                                                                                class="rounded-md border border-[var(--stroke)] px-2 py-1 text-xs font-medium text-[var(--danger)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                on:click|stopPropagation={() => handleRemoveFriend(friend.id)}
                                                                                disabled={removingFriendIds.has(friend.id)}
                                                                        >
                                                                                {m.user_home_friend_remove()}
                                                                        </button>
                                                                </div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-[var(--muted)]">{m.user_home_friends_empty()}</p>
				{/if}
			{:else if friendRequests.length > 0}
				<div class="grid gap-3">
					{#each friendRequests as request (request.id)}
						<div
							class="flex flex-wrap items-center gap-3 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
						>
							<div
								class="grid h-10 w-10 place-items-center rounded-full bg-[var(--panel)] text-sm font-semibold"
							>
								{initialsFor(request.name)}
							</div>
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-semibold">{request.name}</div>
								{#if request.discriminator}
									<div class="truncate text-xs text-[var(--muted)]">#{request.discriminator}</div>
								{/if}
								<div class="truncate text-xs text-[var(--muted)]">
									{#if request.direction === 'incoming'}
										{m.user_home_requests_incoming()}
									{:else if request.direction === 'outgoing'}
										{m.user_home_requests_outgoing()}
									{:else}
										{m.user_home_requests_unknown()}
									{/if}
								</div>
							</div>
                                                        <div class="ml-auto flex flex-wrap items-center gap-2">
                                                                {#if request.direction === 'outgoing'}
                                                                        <button
                                                                                type="button"
                                                                                class="rounded-md border border-[var(--stroke)] px-2 py-1 text-xs font-medium text-[var(--danger)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                on:click={() => handleFriendRequest(request.id, 'decline')}
                                                                                disabled={processingRequestIds.has(request.id)}
                                                                        >
                                                                                {m.user_home_friend_cancel()}
                                                                        </button>
                                                                {:else}
                                                                        <button
                                                                                type="button"
                                                                                class="rounded-md bg-[var(--brand)] px-2 py-1 text-xs font-semibold text-[var(--bg)] transition hover:bg-[var(--brand-strong)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                on:click={() => handleFriendRequest(request.id, 'accept')}
                                                                                disabled={processingRequestIds.has(request.id)}
                                                                        >
                                                                                {m.user_home_friend_accept()}
                                                                        </button>
                                                                        <button
                                                                                type="button"
                                                                                class="rounded-md border border-[var(--stroke)] px-2 py-1 text-xs font-medium text-[var(--danger)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                on:click={() => handleFriendRequest(request.id, 'decline')}
                                                                                disabled={processingRequestIds.has(request.id)}
                                                                        >
                                                                                {request.direction === 'incoming'
                                                                                        ? m.user_home_friend_decline()
                                                                                        : m.user_home_friend_cancel()}
                                                                        </button>
                                                                {/if}
                                                        </div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-[var(--muted)]">{m.user_home_requests_empty()}</p>
			{/if}
		</section>
	</div>
</div>

{#if showAddFriendModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="user-screen-add-friend-title"
	>
		<div class="absolute inset-0 bg-black/50" on:click={closeAddFriendModal} />
		<div
			class="relative z-10 w-full max-w-sm rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-6 shadow-xl"
			role="document"
			on:click|stopPropagation
		>
			<h2 id="user-screen-add-friend-title" class="text-lg font-semibold text-[var(--text-strong)]">
				{m.user_home_add_friend_title()}
			</h2>
			<form
				class="mt-4 space-y-4"
				aria-busy={isSubmittingAddFriend}
				on:submit|preventDefault={handleAddFriendSubmit}
			>
				<label class="flex flex-col gap-2 text-sm">
					<span class="font-medium text-[var(--text-strong)]">
						{m.user_home_add_friend_label()}
					</span>
					<input
						class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:outline-none"
						type="text"
						bind:value={addFriendIdentifier}
						placeholder={m.user_home_add_friend_placeholder()}
					/>
				</label>
				{#if addFriendError}
					<p class="text-sm text-[var(--danger)]" role="alert">{addFriendError}</p>
				{/if}
				<div class="flex justify-end gap-3">
					<button
						type="button"
						class="rounded-md border border-[var(--stroke)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						on:click={closeAddFriendModal}
						disabled={isSubmittingAddFriend}
					>
						{m.cancel()}
					</button>
					<button
						type="submit"
						class="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--bg)] transition hover:bg-[var(--brand-strong)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						disabled={isSubmittingAddFriend || !addFriendIdentifier.trim()}
					>
						{m.user_home_add_friend_submit()}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<svelte:window on:keydown={handleWindowKeydown} />
