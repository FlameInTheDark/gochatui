<script lang="ts">
	import type { DtoChannel, DtoUser } from '$lib/api';
	import { m } from '$lib/paraglide/messages.js';
	import DmCreate from '$lib/components/app/dm/DmCreate.svelte';
        import { auth } from '$lib/stores/auth';
        import { channelsByGuild } from '$lib/stores/appState';
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

        let directChannels: DirectChannelEntry[] = [];
        let friends: FriendEntry[] = [];
        let friendRequests: FriendRequestEntry[] = [];
        let activeList: 'friends' | 'requests' = 'friends';

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
                        const initiatorId =
                                toSnowflakeString(source?.initiator_id ?? source?.initiatorId ?? source?.sender_id);
                        const recipientId =
                                toSnowflakeString(source?.recipient_id ?? source?.recipientId ?? source?.target_id);
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

                const initiatorId =
                        toSnowflakeString(source?.initiator_id ?? source?.initiatorId ?? source?.sender_id);
                const recipientId =
                        toSnowflakeString(source?.recipient_id ?? source?.recipientId ?? source?.target_id);
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

                const initiatorId =
                        toSnowflakeString(source?.initiator_id ?? source?.initiatorId ?? source?.sender_id);
                const recipientId =
                        toSnowflakeString(source?.recipient_id ?? source?.recipientId ?? source?.target_id);
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
</script>

<div class="col-span-2 flex h-full min-h-0 flex-col overflow-hidden">
	<div
		class="flex h-[var(--header-h)] flex-shrink-0 items-center justify-between border-b border-[var(--stroke)] px-5"
	>
		<h1 class="text-base font-semibold">{m.user_home_header()}</h1>
		<div class="flex items-center gap-2">
			<DmCreate />
		</div>
	</div>
	<div class="flex min-h-0 flex-1 overflow-hidden">
                <section class="flex h-full w-80 flex-shrink-0 flex-col border-r border-[var(--stroke)]">
                        <div class="flex flex-col gap-3 border-b border-[var(--stroke)] px-4 py-3">
                                <div class="flex flex-col gap-2">
                                        <button
                                                type="button"
                                                class={`w-full rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                                                        activeList === 'friends'
                                                                ? 'bg-[var(--panel-strong)] text-[var(--text-strong)]'
                                                                : 'text-[var(--muted)] hover:text-[var(--text)]'
                                                }`}
                                                aria-pressed={activeList === 'friends'}
                                                on:click={() => (activeList = 'friends')}
                                        >
                                                {m.user_home_tab_friends()}
                                        </button>
                                        <button
                                                type="button"
                                                class={`w-full rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                                                        activeList === 'requests'
                                                                ? 'bg-[var(--panel-strong)] text-[var(--text-strong)]'
                                                                : 'text-[var(--muted)] hover:text-[var(--text)]'
                                                }`}
                                                aria-pressed={activeList === 'requests'}
                                                on:click={() => (activeList = 'requests')}
                                        >
                                                {m.user_home_tab_requests()}
                                        </button>
                                </div>
                        </div>
                        <div class="flex min-h-0 flex-1 flex-col">
                                <div class="flex-1 overflow-y-auto px-3 py-3">
                                        {#if directChannels.length > 0}
                                                <ul class="space-y-2">
                                                        {#each directChannels as channel (channel.id)}
                                                                <li>
                                                                        <div
                                                                                class="flex items-center gap-3 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
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
                                                                <div class="min-w-0">
                                                                        <div class="truncate text-sm font-semibold">{friend.name}</div>
                                                                        {#if friend.discriminator}
                                                                                <div class="truncate text-xs text-[var(--muted)]">#{friend.discriminator}</div>
                                                                        {/if}
                                                                </div>
                                                        </div>
                                                {/each}
                                        </div>
                                {:else}
                                        <p class="text-sm text-[var(--muted)]">{m.user_home_friends_empty()}</p>
                                {/if}
                        {:else}
                                {#if friendRequests.length > 0}
                                        <div class="grid gap-3">
                                                {#each friendRequests as request (request.id)}
                                                        <div
                                                                class="flex items-center gap-3 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
                                                        >
                                                                <div
                                                                        class="grid h-10 w-10 place-items-center rounded-full bg-[var(--panel)] text-sm font-semibold"
                                                                >
                                                                        {initialsFor(request.name)}
                                                                </div>
                                                                <div class="min-w-0">
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
                                                        </div>
                                                {/each}
                                        </div>
                                {:else}
                                        <p class="text-sm text-[var(--muted)]">{m.user_home_requests_empty()}</p>
                                {/if}
                        {/if}
                </section>
        </div>
</div>
