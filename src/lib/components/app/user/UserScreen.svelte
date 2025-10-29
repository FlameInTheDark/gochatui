<script lang="ts">
        import { onDestroy, onMount } from 'svelte';
        import { get } from 'svelte/store';
        import type { DtoChannel, DtoUser } from '$lib/api';
        import { m } from '$lib/paraglide/messages.js';
        import { auth } from '$lib/stores/auth';
        import {
                activeView,
                channelReady,
                channelsByGuild,
                selectedChannelId,
                selectedGuildId
        } from '$lib/stores/appState';
        import {
                appSettings,
                addVisibleDmChannel,
                NOTIFICATION_LEVELS,
                markDmChannelHidden,
                markDmChannelVisible,
                resolveNotificationLevel,
                setUserNotificationLevel,
                type NotificationLevel
        } from '$lib/stores/settings';
        import MessageInput from '$lib/components/app/chat/MessageInput.svelte';
        import MessageList from '$lib/components/app/chat/MessageList.svelte';
        import UserPanel from '$lib/components/app/user/UserPanel.svelte';
        import { buildAttachmentUrl } from '$lib/utils/cdn';
        import {
                createPresenceSubscription,
                presenceByUser,
                presenceIndicatorClass
        } from '$lib/stores/presence';
        import { memberProfilePanel } from '$lib/stores/memberProfilePanel';
        import { applyFriendList, friendDataRefreshSignal } from '$lib/stores/friends';
        import { Check, X } from 'lucide-svelte';
        import { isMessageNewer } from '$lib/components/app/chat/readStateUtils';
        import { unreadChannelsByGuild } from '$lib/stores/unread';
        import {
                CHANNEL_MENTION_BADGE_CLASSES,
                CHANNEL_UNREAD_BADGE_CLASSES
        } from '$lib/constants/unreadIndicator';
        import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
        import type { ContextMenuActionItem, ContextMenuItem } from '$lib/stores/contextMenu';
        import { customContextMenuTarget } from '$lib/actions/customContextMenuTarget';
        import { channelMentionsByGuild } from '$lib/stores/mentions';

        type FriendEntry = {
                id: string;
                name: string;
                discriminator: string | null;
                avatarUrl: string | null;
        };

        type DirectChannelEntry = {
                id: string;
                label: string;
                recipients: FriendEntry[];
                userId: string | null;
                avatarUrl: string | null;
                isDead: boolean;
                lastMessageId: string | null;
        };

	type FriendRequestDirection = 'incoming' | 'outgoing' | 'unknown';

	type FriendRequestEntry = FriendEntry & {
		direction: FriendRequestDirection;
	};

	const user = auth.user;
        const channelStore = channelsByGuild;
        const settingsStore = appSettings;
        const api = auth.api;
        const presenceMap = presenceByUser;
        const presenceSubscription = createPresenceSubscription();
        const unreadByGuild = unreadChannelsByGuild;
        const mentionStore = channelMentionsByGuild;
        let lastPresenceSignature = '';

        let directChannels = $state<DirectChannelEntry[]>([]);
        let activeDmChannelId = $state<string | null>(null);
        let activeDmTargetId = $state<string | null>(null);
        let activeDmChannel = $state<DirectChannelEntry | null>(null);
        let activeDmRecipient = $state<FriendEntry | null>(null);
        let activeDmTitle = $state('');
        let activeDmSubtext = $state<string | null>(null);
        let activeDmAvatarUrl = $state<string | null>(null);
        let apiFriendList = $state<any[]>([]);
        let apiFriendRequests = $state<any[]>([]);
        let friends = $state<FriendEntry[]>([]);
        let filteredFriends = $state<FriendEntry[]>([]);
        let friendPresenceFilter = $state<'all' | 'online'>('online');
        let friendFilter = $state('');
        let friendRequests = $state<FriendRequestEntry[]>([]);
        let dmChannelError = $state<string | null>(null);
        let activeList = $state<'friends' | 'requests'>('friends');
        let showAddFriendModal = $state(false);
        let addFriendIdentifier = $state('');
        let friendActionError = $state<string | null>(null);
        let friendDataRefreshRequest: Promise<void> | null = null;
        let lastFriendDataSignal = 0;
        let pendingFriendDataSignal = false;
        let isSubmittingAddFriend = $state(false);
        let addFriendError = $state<string | null>(null);
        let removingFriendIds = $state(new Set<string>());
        let processingRequestIds = $state(new Set<string>());
        let openingDmChannelIds = $state(new Set<string>());
        let friendDirectory = $state<Map<string, FriendEntry>>(new Map());
        const friendFilterInputId = 'user-screen-friend-filter';
        const pendingDmRequests = new Map<string, Promise<string | null>>();
        let dmChannelMetadataRequest = $state<Promise<void> | null>(null);
        let dmChannelMetadataToken = 0;
        const CHANNEL_UNREAD_INDICATOR_CLASSES = CHANNEL_UNREAD_BADGE_CLASSES;
        const CHANNEL_MENTION_INDICATOR_CLASSES = CHANNEL_MENTION_BADGE_CLASSES;

        function buildNotificationMenuItems(
                current: NotificationLevel,
                onSelect: (level: NotificationLevel) => void
        ): ContextMenuActionItem[] {
                return [
                        {
                                label: m.ctx_notifications_all(),
                                icon: current === NOTIFICATION_LEVELS.ALL ? Check : undefined,
                                action: () => onSelect(NOTIFICATION_LEVELS.ALL)
                        },
                        {
                                label: m.ctx_notifications_mentions(),
                                icon: current === NOTIFICATION_LEVELS.MENTIONS ? Check : undefined,
                                action: () => onSelect(NOTIFICATION_LEVELS.MENTIONS)
                        },
                        {
                                label: m.ctx_notifications_none(),
                                icon: current === NOTIFICATION_LEVELS.NONE ? Check : undefined,
                                action: () => onSelect(NOTIFICATION_LEVELS.NONE)
                        }
                ];
        }

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

        function dmChannelHasUnread(channelId: unknown): boolean {
                const normalized = toSnowflakeString(channelId);
                if (!normalized) return false;
                const guildUnread = $unreadByGuild?.['@me'] ?? null;
                if (!guildUnread) return false;
                return Boolean(guildUnread[normalized]);
        }

        function formatMentionCount(count: number): string {
                return count > 99 ? '99+' : String(count);
        }

        function dmMentionCount(channelId: unknown): number {
                const normalized = toSnowflakeString(channelId);
                if (!normalized) return 0;
                const entry = $mentionStore?.['@me']?.[normalized] ?? null;
                return entry?.count ?? 0;
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
                        applyFriendList(apiFriendList);
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

        function enqueueFriendDataRefresh() {
                if (friendDataRefreshRequest) {
                        pendingFriendDataSignal = true;
                        return;
                }
                const request = refreshFriendData(false, false).finally(() => {
                        if (friendDataRefreshRequest === request) {
                                friendDataRefreshRequest = null;
                        }
                        if (pendingFriendDataSignal) {
                                pendingFriendDataSignal = false;
                                enqueueFriendDataRefresh();
                        }
                });
                friendDataRefreshRequest = request;
        }

        function buildFriendRecipient(friend: FriendEntry | null): any | null {
                if (!friend) return null;
                const base = {
                        id: friend.id,
                        username: friend.name,
                        global_name: friend.name,
                        display_name: friend.name,
                        discriminator: friend.discriminator,
                        avatar: friend.avatarUrl,
                        avatar_id: friend.avatarUrl,
                        avatarId: friend.avatarUrl,
                        avatarUrl: friend.avatarUrl
                };
                return {
                        ...base,
                        user: {
                                ...base
                        },
                        profile: {
                                ...base
                        }
                };
        }

        function friendEntryToDtoUser(friend: FriendEntry | null): (DtoUser & Record<string, unknown>) | null {
                if (!friend) return null;
                const user: DtoUser & Record<string, unknown> = {
                        name: friend.name
                } as DtoUser & Record<string, unknown>;
                try {
                        user.id = BigInt(friend.id) as any;
                } catch {
                        user.id = friend.id as any;
                }
                if (friend.discriminator) {
                        user.discriminator = friend.discriminator;
                }
                user.username = friend.name;
                user.display_name = friend.name;
                user.global_name = friend.name;
                if (friend.avatarUrl) {
                        user.avatarUrl = friend.avatarUrl;
                }
                return user;
        }

        function openActiveDmProfile(event: MouseEvent) {
                const friend = activeDmRecipient ?? activeDmChannel?.recipients?.[0] ?? null;
                const user = friendEntryToDtoUser(friend);
                if (!user) {
                        return;
                }
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
                        member: null,
                        user,
                        guildId: null,
                        anchor
                });
        }

        function enrichDirectChannel(channel: DtoChannel, friend: FriendEntry | null): DtoChannel {
                if (!friend) return channel;
                const recipient = buildFriendRecipient(friend);
                const existingRecipients = Array.isArray((channel as any)?.recipients)
                        ? [...((channel as any).recipients as any[])]
                        : [];
                if (recipient && !existingRecipients.some((entry) => toSnowflakeString(entry?.id) === friend.id)) {
                        existingRecipients.push(recipient);
                }
                const enriched: any = {
                        ...channel,
                        name: friend.name,
                        recipients: existingRecipients
                };
                if (!enriched.icon && friend.avatarUrl) {
                        enriched.icon = friend.avatarUrl;
                        enriched.iconUrl = friend.avatarUrl;
                        enriched.avatar = friend.avatarUrl;
                        enriched.avatarUrl = friend.avatarUrl;
                }
                return enriched;
        }

        async function ensureDirectChannel(
                target: string | FriendEntry | null | undefined
        ): Promise<string | null> {
                const friendHint: FriendEntry | null =
                        target && typeof target === 'object' ? { ...target } : null;
                const normalizedUserId = toSnowflakeString(
                        friendHint ? friendHint.id : (target as string | null | undefined)
                );
                if (!normalizedUserId) {
                        dmChannelError = m.user_home_friend_action_error();
                        return null;
                }
                const settings = get(settingsStore);
                const channelMap = get(channelStore) ?? {};
                const meSnowflake = toSnowflakeString(($user as any)?.id);
                const fallbackName = m.user_default_name();
                const hiddenSettingEntry = settings.dmChannels.find((entry) => {
                        if (!entry.hidden) return false;
                        const entryUserId = toSnowflakeString(entry.userId);
                        if (entryUserId && entryUserId === normalizedUserId) return true;
                        const entryChannelId = toSnowflakeString(entry.channelId);
                        if (!entryChannelId) return false;
                        const dmList = Array.isArray(channelMap['@me']) ? channelMap['@me'] : [];
                        const match = dmList.find(
                                (candidate: any) => toSnowflakeString((candidate as any)?.id) === entryChannelId
                        );
                        if (!match) return false;
                        const normalized = normalizeDirectChannel(
                                match,
                                meSnowflake,
                                fallbackName
                        );
                        if (!normalized) return false;
                        if (normalized.userId && normalized.userId === normalizedUserId) {
                                return true;
                        }
                        if (
                                normalized.recipients.length === 1 &&
                                normalized.recipients[0]?.id === normalizedUserId
                        ) {
                                return true;
                        }
                        return false;
                });
                if (hiddenSettingEntry) {
                        const hiddenChannelId = toSnowflakeString(hiddenSettingEntry.channelId);
                        if (hiddenChannelId) {
                                addVisibleDmChannel(hiddenChannelId, normalizedUserId, {
                                        isDead: hiddenSettingEntry.isDead
                                });
                                return hiddenChannelId;
                        }
                }
                const existing: DirectChannelEntry | undefined = directChannels.find(
                        (entry) => entry.userId === normalizedUserId
                );
                if (existing) {
                        addVisibleDmChannel(existing.id, normalizedUserId, { isDead: existing.isDead });
                        return existing.id;
                }
                const pending = pendingDmRequests.get(normalizedUserId);
                if (pending) {
                        return pending;
                }
                const request = (async () => {
                        const snowflake = toSnowflakeBigInt(normalizedUserId);
                        if (!snowflake) {
                                dmChannelError = m.user_home_friend_action_error();
                                return null;
                        }
                        setDmChannelLoading(normalizedUserId, true);
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
                                const friendEntry =
                                        friendHint ?? friendDirectory.get(normalizedUserId) ?? null;
                                const enriched = enrichDirectChannel(normalized, friendEntry);
                                channelsByGuild.update((map) => {
                                        const dmKey = '@me';
                                        const existingList = Array.isArray(map[dmKey]) ? map[dmKey] : [];
                                        const filtered = existingList.filter(
                                                (entry) => toSnowflakeString((entry as any)?.id) !== channelId
                                        );
                                        return {
                                                ...map,
                                                [dmKey]: [...filtered, enriched]
                                        };
                                });
                                addVisibleDmChannel(channelId, normalizedUserId, {
                                        isDead: detectDirectChannelDeadState(channel)
                                });
                                return channelId;
                        } catch (error) {
                                console.error('Failed to open DM channel', error);
                                dmChannelError = m.user_home_friend_action_error();
                                return null;
                        } finally {
                                setDmChannelLoading(normalizedUserId, false);
                        }
                })();
                pendingDmRequests.set(normalizedUserId, request);
                request.finally(() => pendingDmRequests.delete(normalizedUserId));
                return request;
        }

        function openDirectChannelById(
                channelId: string | null | undefined,
                targetUserId?: string | null | undefined
        ) {
                const normalizedChannelId = toSnowflakeString(channelId);
                if (!normalizedChannelId) {
                        dmChannelError = m.user_home_friend_action_error();
                        return;
                }
                const normalizedTargetId = toSnowflakeString(targetUserId) ?? null;
                dmChannelError = null;
                activeDmChannelId = normalizedChannelId;
                activeDmTargetId = normalizedTargetId;
                activeView.set('user');
                channelReady.set(false);
                selectedChannelId.set(null);
                selectedGuildId.set('@me');
                selectedChannelId.set(normalizedChannelId);
                const existingEntry = directChannels.find(
                        (entry) => toSnowflakeString(entry.id) === normalizedChannelId
                );
                addVisibleDmChannel(normalizedChannelId, normalizedTargetId, {
                        isDead: existingEntry?.isDead
                });
                channelReady.set(true);
        }

        async function handleFriendOpenDirectChannel(friend: FriendEntry) {
                const channelId = await ensureDirectChannel(friend ?? null);
                if (channelId) {
                        openDirectChannelById(channelId, friend.id);
                }
        }

        async function handleActivateDirectChannel(channel: DirectChannelEntry) {
                const candidateTarget =
                        channel.userId ??
                        (channel.recipients.length === 1 ? channel.recipients[0]?.id ?? null : null);
                if (candidateTarget) {
                        const ensuredChannelId = await ensureDirectChannel(candidateTarget);
                        if (ensuredChannelId) {
                                openDirectChannelById(ensuredChannelId, candidateTarget);
                                return;
                        }
                }
                openDirectChannelById(channel.id, candidateTarget);
        }

        function handleHideDirectChannel(channelId: string) {
                const normalizedChannelId = toSnowflakeString(channelId);
                if (!normalizedChannelId) return;
                const entry = directChannels.find((candidate) => candidate.id === normalizedChannelId) ?? null;
                const lastMessageId = entry?.lastMessageId ?? null;
                markDmChannelHidden(normalizedChannelId, lastMessageId);
                if (activeDmChannelId === normalizedChannelId) {
                        clearActiveDmChannel();
                }
        }

        function clearActiveDmChannel() {
                activeDmChannelId = null;
                activeDmTargetId = null;
                activeDmChannel = null;
                activeDmRecipient = null;
                activeDmTitle = '';
                activeDmSubtext = null;
                activeDmAvatarUrl = null;
                channelReady.set(false);
                selectedChannelId.set(null);
                if (get(selectedGuildId) === '@me') {
                        selectedGuildId.set(null);
                }
                activeView.set('user');
        }

        function activateList(next: 'friends' | 'requests') {
                activeList = next;
                if (activeDmChannelId) {
                        clearActiveDmChannel();
                }
        }

        onMount(() => {
                void refreshFriendData(false, true);
        });

        onDestroy(() => {
                presenceSubscription.destroy();
        });

        $effect(() => {
                const token = $friendDataRefreshSignal;
                if (!token || token === lastFriendDataSignal) {
                        return;
                }
                lastFriendDataSignal = token;
                enqueueFriendDataRefresh();
        });

        function extractUserCandidate(candidate: any): DtoUser | null {
                if (!candidate) return null;

                const seen = new Set<any>();
                const queue: any[] = [candidate];

                const isLikelyUser = (value: any): value is DtoUser => {
                        if (!value || typeof value !== 'object') return false;
                        const id =
                                toSnowflakeString((value as any)?.id) ??
                                toSnowflakeString((value as any)?.user_id) ??
                                toSnowflakeString((value as any)?.userId);
                        if (!id) return false;
                        if (
                                typeof (value as any)?.username === 'string' ||
                                typeof (value as any)?.name === 'string' ||
                                typeof (value as any)?.display_name === 'string'
                        ) {
                                return true;
                        }
                        if (typeof (value as any)?.discriminator === 'string') {
                                return true;
                        }
                        if (
                                (value as any)?.avatar != null ||
                                (value as any)?.avatarUrl != null ||
                                (value as any)?.avatar_url != null
                        ) {
                                return true;
                        }
                        return false;
                };

                while (queue.length) {
                        const current = queue.shift();
                        if (!current || typeof current !== 'object') continue;
                        if (seen.has(current)) continue;
                        seen.add(current);

                        if (isLikelyUser(current)) {
                                return current as DtoUser;
                        }

                        const nextCandidates: any[] = [
                                current.user,
                                current.member?.user,
                                current.profile?.user,
                                current.profile,
                                current.target,
                                current.relationship,
                                current.relationship?.user,
                                current.relationship?.member?.user,
                                current.relationship?.profile,
                                current.relationship?.profile?.user,
                                current.relationship?.target,
                                current.friend,
                                current.friend?.user,
                                current.friend?.profile,
                                current.recipient,
                                current.sender,
                                current.initiator,
                                current.request,
                                current.request?.user,
                                current.target_user,
                                current.targetUser,
                                current.data,
                                current.value
                        ];

                        if (Array.isArray(current.recipients)) {
                                nextCandidates.push(...current.recipients);
                        }

                        for (const next of nextCandidates) {
                                if (!next || typeof next !== 'object') continue;
                                if (seen.has(next)) continue;
                                queue.push(next);
                        }
                }

                return null;
        }

        function normalizeAvatarValue(value: any): string | null {
                if (value == null) return null;
                if (typeof value === 'object') {
                        if (typeof value.url === 'string') {
                                return normalizeAvatarValue(value.url);
                        }
                        if ('id' in value) {
                                return normalizeAvatarValue((value as any).id);
                        }
                        if ('avatar' in value) {
                                return normalizeAvatarValue((value as any).avatar);
                        }
                }
                if (typeof value === 'string') {
                        const trimmed = value.trim();
                        if (!trimmed) return null;
                        if (/^https?:\/\//i.test(trimmed)) {
                                return trimmed;
                        }
                        return buildAttachmentUrl(trimmed);
                }
                return buildAttachmentUrl(value);
        }

        function resolveAvatarUrl(source: any): string | null {
                if (!source) return null;
                const candidates = [
                        source?.avatarUrl,
                        source?.avatar_url,
                        source?.avatar,
                        source?.avatarId,
                        source?.avatar_id,
                        source?.image,
                        source?.icon,
                        source?.iconUrl,
                        source?.icon_url,
                        source?.profile?.avatarUrl,
                        source?.profile?.avatar_url,
                        source?.profile?.avatar,
                        source?.profile?.avatarId,
                        source?.profile?.avatar_id,
                        source?.profile?.image,
                        source?.profile?.icon,
                        source?.profile?.iconUrl,
                        source?.profile?.icon_url,
                        source?.user?.avatarUrl,
                        source?.user?.avatar_url,
                        source?.user?.avatar,
                        source?.user?.avatarId,
                        source?.user?.avatar_id,
                        source?.member?.avatarUrl,
                        source?.member?.avatar_url,
                        source?.member?.avatar,
                        source?.member?.avatarId,
                        source?.member?.avatar_id,
                        source?.member?.user?.avatar,
                        source?.member?.user?.avatarUrl,
                        source?.member?.user?.avatar_url
                ];
                for (const candidate of candidates) {
                        const resolved = normalizeAvatarValue(candidate);
                        if (resolved) return resolved;
                }
                return null;
        }

	function normalizeFriendEntry(value: any, fallbackName: string): FriendEntry | null {
		const base = extractUserCandidate(value);
		if (!base) return null;
                const id =
                        toSnowflakeString((base as any)?.id) ??
                        toSnowflakeString((value as any)?.user_id) ??
                        toSnowflakeString((value as any)?.userId) ??
                        toSnowflakeString((value as any)?.relationship?.user_id) ??
                        toSnowflakeString((value as any)?.relationship?.userId);
                if (!id) return null;
                const nameSource =
                        (base as any)?.name ??
                        (base as any)?.username ??
                        (base as any)?.display_name ??
                        (value as any)?.name ??
                        (value as any)?.username ??
                        (value as any)?.display_name ??
                        (value as any)?.relationship?.name ??
                        (value as any)?.relationship?.username ??
                        (value as any)?.relationship?.display_name;
                const name =
                        typeof nameSource === 'string' && nameSource.trim() ? nameSource.trim() : fallbackName;
                const discSource =
                        (base as any)?.discriminator ??
                        (base as any)?.tag ??
                        (value as any)?.discriminator ??
                        (value as any)?.tag ??
                        (value as any)?.relationship?.discriminator ??
                        (value as any)?.relationship?.tag;
                const discriminator =
                        typeof discSource === 'string' && discSource.trim() ? discSource.trim() : null;
                const avatarUrl =
                        resolveAvatarUrl(base) ?? resolveAvatarUrl(value) ?? null;
                return { id, name, discriminator, avatarUrl };
        }

        function detectDirectChannelDeadState(raw: any): boolean {
                if (!raw || typeof raw !== 'object') return false;
                if (raw.dead === true || raw.is_dead === true || raw.isDead === true) {
                        return true;
                }
                const stateCandidates = [
                        raw.state,
                        raw.status,
                        raw.channel_state,
                        raw.channelState,
                        raw.dm_state,
                        raw.dmState,
                        raw.relationship_state
                ];
                for (const candidate of stateCandidates) {
                        if (typeof candidate !== 'string') continue;
                        const normalized = candidate.trim().toLowerCase();
                        if (!normalized) continue;
                        if (normalized === 'dead' || normalized.endsWith(':dead') || normalized.includes('dead')) {
                                return true;
                        }
                }
                return false;
        }

        function extractChannelLastMessageId(raw: any): string | null {
                const tryResolve = (value: any): string | null => {
                        if (value == null) return null;
                        if (typeof value === 'object') {
                                const nested = toSnowflakeString((value as any)?.id);
                                if (nested) return nested;
                        }
                        return toSnowflakeString(value);
                };
                const candidates = [
                        raw?.last_message_id,
                        raw?.lastMessageId,
                        raw?.last_message,
                        raw?.lastMessage
                ];
                for (const candidate of candidates) {
                        const resolved = tryResolve(candidate);
                        if (resolved) return resolved;
                }
                return null;
        }

        function compareMessageIdsDesc(a: string | null, b: string | null): number {
                if (a && b) {
                        if (isMessageNewer(a, b)) return -1;
                        if (isMessageNewer(b, a)) return 1;
                        return 0;
                }
                if (a) return -1;
                if (b) return 1;
                return 0;
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
                const rawUserId =
                        toSnowflakeString(raw?.user_id) ??
                        toSnowflakeString(raw?.userId) ??
                        toSnowflakeString(raw?.recipient_id) ??
                        toSnowflakeString(raw?.recipientId);
                const fallbackRecipientId = recipients.length === 1 ? recipients[0]?.id ?? null : null;
                const channelAvatar =
                        recipients.length === 1
                                ? recipients[0]?.avatarUrl ?? resolveAvatarUrl(raw)
                                : resolveAvatarUrl(raw);
                const isDead = detectDirectChannelDeadState(raw);

                return {
                        id,
                        label,
                        recipients,
                        userId: rawUserId ?? fallbackRecipientId ?? null,
                        avatarUrl: channelAvatar ?? null,
                        isDead,
                        lastMessageId: extractChannelLastMessageId(raw)
                };
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
                const relationCandidates = [
                        source,
                        source?.relationship,
                        source?.relationship?.relationship,
                        source?.friend,
                        source?.friendship,
                        source?.request,
                        source?.data,
                        source?.value
                ];

                const pick = <T>(resolver: (candidate: any) => T | null | undefined): T | null => {
                        for (const candidate of relationCandidates) {
                                if (!candidate) continue;
                                const result = resolver(candidate);
                                if (result != null) {
                                        return result as T;
                                }
                        }
                        return null;
                };

                const rawType = pick((candidate) =>
                        candidate?.relationship_type ??
                        candidate?.relationshipType ??
                        candidate?.type ??
                        candidate?.status ??
                        candidate?.state ??
                        candidate?.kind ??
                        null
                );

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

                const directionField = pick((candidate) => candidate?.direction ?? candidate?.request_direction);
                if (typeof directionField === 'string') {
                        const lowered = directionField.toLowerCase();
                        if (['incoming', 'inbound', 'received'].includes(lowered)) {
                                return 'incoming_request';
                        }
			if (['outgoing', 'outbound', 'sent'].includes(lowered)) {
				return 'outgoing_request';
			}
		}

                const incomingLike = pick((candidate) =>
                        candidate?.incoming ??
                        candidate?.is_incoming ??
                        candidate?.incoming_request ??
                        candidate?.is_received ??
                        null
                );
                const outgoingLike = pick((candidate) =>
                        candidate?.outgoing ??
                        candidate?.is_outgoing ??
                        candidate?.outgoing_request ??
                        candidate?.is_sent ??
                        null
                );

                if (incomingLike === true && outgoingLike !== true) {
                        return 'incoming_request';
                }
                if (outgoingLike === true && incomingLike !== true) {
                        return 'outgoing_request';
                }

                const pendingLike = pick((candidate) =>
                        candidate?.pending ?? candidate?.is_pending ?? candidate?.request ?? null
                );
                if (pendingLike === true) {
                        const initiatorId = toSnowflakeString(
                                pick((candidate) =>
                                        candidate?.initiator_id ?? candidate?.initiatorId ?? candidate?.sender_id ?? null
                                )
                        );
                        const recipientId = toSnowflakeString(
                                pick((candidate) =>
                                        candidate?.recipient_id ?? candidate?.recipientId ?? candidate?.target_id ?? null
                                )
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
                        pick((candidate) =>
                                candidate?.initiator_id ?? candidate?.initiatorId ?? candidate?.sender_id ?? null
                        )
                );
                const recipientId = toSnowflakeString(
                        pick((candidate) =>
                                candidate?.recipient_id ?? candidate?.recipientId ?? candidate?.target_id ?? null
                        )
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

        $effect(() => {
                const fallbackName = m.user_default_name();
                const meId = toSnowflakeString(($user as any)?.id);
                const userData = $user as any;
                const candidateCollections = [
                        apiFriendList,
                        userData?.friends,
                        userData?.friend_list,
                        userData?.relationships,
                        userData?.relationship_list
                ];
                const nextDirectory = new Map<string, FriendEntry>();
                for (const collection of candidateCollections) {
                        if (!Array.isArray(collection)) continue;
                        for (const entry of collection) {
                                const normalized = normalizeFriendEntry(entry, fallbackName);
                                if (!normalized) continue;
                                if (meId && normalized.id === meId) continue;
                                if (!nextDirectory.has(normalized.id)) {
                                        nextDirectory.set(normalized.id, normalized);
                                }
                        }
                }
                friendDirectory = nextDirectory;
        });

        $effect(() => {
                const meId = toSnowflakeString(($user as any)?.id);
                const fallbackName = m.user_default_name();
                const sources: any[] = [];
                const userData = $user as any;
                const settingsDmChannels = $settingsStore.dmChannels;
                const dmVisibility = new Set(settingsDmChannels.map((entry) => entry.channelId));
                const dmUserHints = new Map(
                        settingsDmChannels.map((entry) => [entry.channelId, entry.userId ?? null])
                );
                const dmSettingsById = new Map(settingsDmChannels.map((entry) => [entry.channelId, entry]));
                const restrictToVisible = dmVisibility.size > 0;
                const autoUnhide = new Set<string>();
                const candidateFields = ['dm_channels', 'direct_channels', 'directs', 'channels'];
                for (const field of candidateFields) {
                        const value = userData?.[field];
                        if (Array.isArray(value)) {
                                sources.push(...value);
                        }
                }
                const map = $channelStore as Record<string, DtoChannel[]> | undefined;
                const dmChannelDataById = new Map<string, any>();
                if (map && typeof map === 'object') {
                        const dmListRaw = map['@me'];
                        if (Array.isArray(dmListRaw)) {
                                for (const channel of dmListRaw) {
                                        const normalized = normalizeDtoChannel(channel);
                                        const id = toSnowflakeString((normalized as any)?.id);
                                        if (!id) continue;
                                        dmChannelDataById.set(id, normalized);
                                }
                        }
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
                        const storedSettings = dmSettingsById.get(normalized.id) ?? null;
                        if (storedSettings?.hidden === true) {
                                if (
                                        isMessageNewer(
                                                normalized.lastMessageId ?? null,
                                                storedSettings.hiddenAfterMessageId ?? null
                                        )
                                ) {
                                        autoUnhide.add(normalized.id);
                                } else {
                                        continue;
                                }
                        }
                        if (seen.has(normalized.id)) continue;
                        seen.add(normalized.id);
                        const storedUserId = dmUserHints.get(normalized.id) ?? null;
                        if (storedUserId && normalized.userId !== storedUserId) {
                                normalized.userId = storedUserId;
                        } else if (!normalized.userId && normalized.recipients.length === 1) {
                                normalized.userId = normalized.recipients[0]?.id ?? null;
                        }
                        const candidateId =
                                normalized.userId ??
                                storedUserId ??
                                (normalized.recipients.length === 1
                                        ? normalized.recipients[0]?.id ?? null
                                        : null);
                        if (candidateId) {
                                const friend = friendDirectory.get(candidateId) ?? null;
                                if (friend) {
                                        normalized.label = friend.name;
                                        if (normalized.recipients.length === 0) {
                                                normalized.recipients = [friend];
                                        }
                                        if (!normalized.avatarUrl) {
                                                normalized.avatarUrl = friend.avatarUrl ?? null;
                                        }
                                }
                        }
                        if (!normalized.lastMessageId) {
                                const channelSource = dmChannelDataById.get(normalized.id);
                                if (channelSource) {
                                        normalized.lastMessageId = extractChannelLastMessageId(channelSource);
                                }
                        }
                        result.push(normalized);
                }
                for (const entry of settingsDmChannels) {
                        const channelId = toSnowflakeString(entry.channelId);
                        if (!channelId || seen.has(channelId)) continue;
                        if (entry.hidden) continue;
                        seen.add(channelId);
                        const storedUserId = entry.userId ? toSnowflakeString(entry.userId) : null;
                        const friend = storedUserId ? friendDirectory.get(storedUserId) ?? null : null;
                        const channelSource = dmChannelDataById.get(channelId) ?? null;
                        result.push({
                                id: channelId,
                                label: friend?.name ?? m.user_home_dm_placeholder(),
                                recipients: friend ? [friend] : [],
                                userId: storedUserId,
                                avatarUrl: friend?.avatarUrl ?? null,
                                isDead: entry.isDead ?? false,
                                lastMessageId: channelSource
                                        ? extractChannelLastMessageId(channelSource)
                                        : null
                        });
                }
                result.sort((a, b) => {
                        const messageOrder = compareMessageIdsDesc(
                                a.lastMessageId ?? null,
                                b.lastMessageId ?? null
                        );
                        if (messageOrder !== 0) {
                                return messageOrder;
                        }
                        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
                });
                directChannels = result;
                if (autoUnhide.size > 0) {
                        for (const id of autoUnhide) {
                                markDmChannelVisible(id);
                        }
                }
        });

        async function ensureVisibleDmChannelMetadata(): Promise<void> {
                const settings = $settingsStore;
                const map = $channelsByGuild;
                const visible = Array.isArray(settings.dmChannels)
                        ? settings.dmChannels
                                        .map((entry) => toSnowflakeString(entry.channelId))
                                        .filter((id): id is string => Boolean(id))
                        : [];
                if (!visible.length) return;
                const existingList = Array.isArray(map['@me']) ? map['@me'] : [];
                const existing = new Set(
                        existingList
                                .map((channel: any) => toSnowflakeString((channel as any)?.id))
                                .filter((id): id is string => Boolean(id))
                );
                const missing = visible.filter((id) => !existing.has(id));
                if (!missing.length) return;
                const token = ++dmChannelMetadataToken;
                try {
                        const response = await api.user.userMeChannelsGet();
                        if (dmChannelMetadataToken !== token) return;
                        const fetched = Array.isArray(response?.data) ? response.data : [];
                        if (!fetched.length) return;
                        channelsByGuild.update((current) => {
                                const existingChannels = Array.isArray(current['@me']) ? current['@me'] : [];
                                const byId = new Map<string, DtoChannel>();
                                for (const channel of existingChannels) {
                                        const id = toSnowflakeString((channel as any)?.id);
                                        if (!id) continue;
                                        byId.set(id, channel as DtoChannel);
                                }
                                for (const entry of fetched) {
                                        const normalized = normalizeDtoChannel(entry) as DtoChannel;
                                        const id = toSnowflakeString((normalized as any)?.id);
                                        if (!id) continue;
                                        byId.set(id, normalized);
                                }
                                return { ...current, ['@me']: Array.from(byId.values()) };
                        });
                } catch (error) {
                        console.error('Failed to load DM channels', error);
                }
        }

        $effect(() => {
                const dmEntries = $settingsStore.dmChannels;
                const dmList = $channelsByGuild['@me'] ?? [];
                const missing = dmEntries.some((entry) => {
                        const id = toSnowflakeString(entry.channelId);
                        if (!id) return false;
                        return !dmList.some((channel: any) => toSnowflakeString((channel as any)?.id) === id);
                });
                if (!missing) return;
                if (dmChannelMetadataRequest) return;
                const request = ensureVisibleDmChannelMetadata().finally(() => {
                        if (dmChannelMetadataRequest === request) {
                                dmChannelMetadataRequest = null;
                        }
                });
                dmChannelMetadataRequest = request;
        });

        $effect(() => {
                const current = directChannels.find((entry) => entry.id === activeDmChannelId) ?? null;
                activeDmChannel = current;
                if (current?.userId) {
                        activeDmTargetId = current.userId;
                }
                if (current) {
                        if (current.recipients.length === 1) {
                                const recipient = current.recipients[0] ?? null;
                                activeDmRecipient = recipient;
                                activeDmTitle = recipient?.name ?? current.label;
                                if (current.label && current.label !== activeDmTitle) {
                                        activeDmSubtext = current.label;
                                } else {
                                        activeDmSubtext = null;
                                }
                                activeDmAvatarUrl = recipient?.avatarUrl ?? current.avatarUrl ?? null;
                        } else {
                                activeDmRecipient = null;
                                activeDmTitle = current.label;
                                activeDmSubtext =
                                        current.recipients.length > 1
                                                ? current.recipients.map((entry) => entry.name).join(', ')
                                                : null;
                                activeDmAvatarUrl = current.avatarUrl ?? null;
                        }
                } else {
                        activeDmRecipient = null;
                        activeDmTitle = '';
                        activeDmSubtext = null;
                        activeDmAvatarUrl = null;
                }
        });

        $effect(() => {
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
        });

        $effect(() => {
                const query = friendFilter.trim().toLowerCase();
                const presenceFilter = friendPresenceFilter;
                const lookup = $presenceMap;
                const hasQuery = query.length > 0;
                const requireOnline = presenceFilter === 'online';

                if (!hasQuery && !requireOnline) {
                        filteredFriends = friends;
                        return;
                }

                filteredFriends = friends.filter((entry) => {
                        if (requireOnline) {
                                const status = lookup[entry.id]?.status ?? 'offline';
                                if (status === 'offline') {
                                        return false;
                                }
                        }

                        if (!hasQuery) return true;

                        const nameMatch = entry.name.toLowerCase().includes(query);
                        if (nameMatch) return true;
                        if (entry.discriminator) {
                                const normalizedDisc = entry.discriminator.toLowerCase();
                                if (normalizedDisc.includes(query)) return true;
                                return `#${normalizedDisc}`.includes(query);
                        }
                        return false;
                });
        });

        $effect(() => {
                const tracked = new Set<string>();
                for (const friend of friends) {
                        const id = toSnowflakeString(friend?.id);
                        if (id) tracked.add(id);
                }
                for (const channel of directChannels) {
                        if (!channel) continue;
                        const directIds: Array<string | null | undefined> = [channel.userId];
                        for (const recipient of channel.recipients) {
                                directIds.push(recipient?.id ?? null);
                        }
                        for (const value of directIds) {
                                const id = toSnowflakeString(value);
                                if (id) tracked.add(id);
                        }
                }
                const ids = Array.from(tracked).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
                const signature = ids.join(',');
                if (signature !== lastPresenceSignature) {
                        presenceSubscription.update(ids);
                        lastPresenceSignature = signature;
                }
        });

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
                addFriendIdentifier = '';
                addFriendError = null;
                showAddFriendModal = false;
        }

        function handleAddFriendBackdropClick(event: MouseEvent) {
                if (event.target === event.currentTarget) {
                        closeAddFriendModal();
                }
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

        function openFriendContextMenu(event: MouseEvent, friend: FriendEntry) {
                event.preventDefault();
                event.stopPropagation();
                const friendId = friend.id;
                if (!friendId) return;
                const currentLevel = resolveNotificationLevel($settingsStore.userNotifications[friendId]);
                const items: ContextMenuItem[] = [
                        {
                                label: m.ctx_notifications_menu(),
                                children: buildNotificationMenuItems(currentLevel, (level) =>
                                        setUserNotificationLevel(friendId, level)
                                )
                        },
                        {
                                label: m.ctx_copy_user_id(),
                                action: () => copyToClipboard(friendId)
                        }
                ];
                contextMenu.openFromEvent(event, items);
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
			onclick={openAddFriendModal}
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
                                                onclick={() => activateList('friends')}
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
                                                onclick={() => activateList('requests')}
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
                                                                {@const targetIdRaw =
                                                                        channel.userId ??
                                                                        (channel.recipients.length === 1
                                                                                ? channel.recipients[0]?.id ?? null
                                                                                : null)}
                                                                {@const targetId = toSnowflakeString(targetIdRaw)}
                                                                {@const isLoading = targetId ? openingDmChannelIds.has(targetId) : false}
                                                                {@const isActive = activeDmChannelId === channel.id}
                                                                {@const hasUnread = dmChannelHasUnread(channel.id)}
                                                                {@const mentionCount = dmMentionCount(channel.id)}
                                                                {@const indicatorPaddingClass =
                                                                        mentionCount > 0
                                                                                ? 'pl-9'
                                                                                : hasUnread
                                                                                        ? 'pl-6'
                                                                                        : 'pl-3'}
                                                                {@const showUnreadDot = mentionCount === 0 && hasUnread}
                                                                {@const recipient =
                                                                        channel.recipients.length === 1
                                                                                ? channel.recipients[0]
                                                                                : null}
                                                                {@const displayName = recipient ? recipient.name : channel.label}
                                                                {@const avatarUrl = recipient?.avatarUrl ?? channel.avatarUrl}
                                                                {@const showSecondaryLabel =
                                                                        recipient && channel.label && channel.label !== recipient.name
                                                                                ? channel.label
                                                                                : null}
                                                                {@const secondaryLine =
                                                                        recipient
                                                                                ? showSecondaryLabel
                                                                                : channel.recipients.length > 1
                                                                                        ? channel.recipients.map((entry) => entry.name).join(', ')
                                                                                        : null}
                                                                {@const presenceInfo = targetId ? $presenceMap[targetId] ?? null : null}
                                                                {@const presenceStatus = presenceInfo?.status ?? null}
                                                                {@const customStatus = presenceInfo?.customStatusText ?? null}
                                                                <li>
                                                                        <div class={`group relative ${isLoading ? 'opacity-70' : ''}`}>
                                                                                <button
                                                                                        type="button"
                                                                                        class={`relative flex w-full items-center gap-3 rounded-md border py-2 pr-12 text-left transition ${
                                                                                                isActive
                                                                                                        ? 'border-[var(--brand)] bg-[var(--panel)] text-[var(--text-strong)]'
                                                                                                        : 'border-[var(--stroke)] bg-[var(--panel-strong)] hover:border-[var(--brand)]/40 hover:bg-[var(--panel)]'
                                                                                        } ${indicatorPaddingClass} ${isLoading ? 'cursor-wait' : ''}`}
                                                                                        disabled={isLoading}
                                                                                        aria-busy={isLoading}
                                                                                        aria-pressed={isActive}
                                                                                        onclick={() => handleActivateDirectChannel(channel)}
                                                                                >
                                                                                        {#if mentionCount > 0}
                                                                                                <span class="sr-only">{m.unread_mentions_indicator({ count: mentionCount })}</span>
                                                                                                <span aria-hidden="true" class={CHANNEL_MENTION_INDICATOR_CLASSES}>
                                                                                                        {formatMentionCount(mentionCount)}
                                                                                                </span>
                                                                                        {:else if showUnreadDot}
                                                                                                <span class="sr-only">{m.unread_indicator()}</span>
                                                                                                <span aria-hidden="true" class={CHANNEL_UNREAD_INDICATOR_CLASSES}></span>
                                                                                        {/if}
                                                                                        <div class="relative">
                                                                                                <div class="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[var(--panel)] text-sm font-semibold">
                                                                                                        {#if avatarUrl}
                                                                                                                <img alt={displayName} class="h-full w-full object-cover" src={avatarUrl} />
                                                                                                        {:else}
                                                                                                                <span>{initialsFor(displayName)}</span>
                                                                                                        {/if}
                                                                                                </div>
                                                                                                {#if targetId}
                                                                                                        <span
                                                                                                                class={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${presenceIndicatorClass(presenceStatus)}`}
                                                                                                        ></span>
                                                                                                {/if}
                                                                                        </div>
                                                                                        <div class="min-w-0 flex-1">
                                                                                                <div class="truncate text-sm font-semibold">{displayName}</div>
                                                                                                {#if secondaryLine}
                                                                                                        <div class="truncate text-xs text-[var(--muted)]">{secondaryLine}</div>
                                                                                                {/if}
                                                                                                {#if customStatus}
                                                                                                        <div class="truncate text-xs text-[var(--muted)]">{customStatus}</div>
                                                                                                {/if}
                                                                                        </div>
                                                                                </button>
                                                                                <button
                                                                                        type="button"
                                                                                        class={`absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--stroke)] bg-[var(--panel)] text-[var(--muted)] transition focus-visible:border-[var(--danger)] focus-visible:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40 focus-visible:outline-none ${
                                                                                                isActive
                                                                                                        ? 'opacity-100'
                                                                                                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                                                                                        }`}
                                                                                        disabled={isLoading}
                                                                                        onclick={(event) => {
                                                                                                event.stopPropagation();
                                                                                                handleHideDirectChannel(channel.id);
                                                                                        }}
                                                                                        aria-label={m.user_home_dm_remove()}
                                                                                        title={m.user_home_dm_remove()}
                                                                                >
                                                                                        <X class="h-4 w-4" stroke-width={2} />
                                                                                </button>
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
                <section class="flex flex-1 flex-col overflow-hidden">
                        {#if activeDmChannel}
                                <div class="flex h-[var(--header-h)] flex-shrink-0 items-center gap-4 border-b border-[var(--stroke)] px-6">
                                        <div class="flex min-w-0 items-center gap-3">
                                                <button
                                                        type="button"
                                                        class="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-[var(--panel)] text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                                        onclick={openActiveDmProfile}
                                                        aria-label={activeDmTitle || m.user_home_header()}
                                                >
                                                        {#if activeDmAvatarUrl}
                                                                <img alt={activeDmTitle} class="h-full w-full object-cover" src={activeDmAvatarUrl} />
                                                        {:else}
                                                                <span>{initialsFor(activeDmTitle)}</span>
                                                        {/if}
                                                </button>
                                                <div class="min-w-0">
                                                        <button
                                                                type="button"
                                                                class="min-w-0 rounded-md px-1 py-0.5 text-left transition hover:bg-[var(--panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                                                onclick={openActiveDmProfile}
                                                        >
                                                                <div class="truncate text-base font-semibold">{activeDmTitle || m.user_home_header()}</div>
                                                                {#if activeDmSubtext}
                                                                        <div class="truncate text-sm text-[var(--muted)]">{activeDmSubtext}</div>
                                                                {/if}
                                                        </button>
                                                </div>
                                        </div>
                                </div>
                                <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                                        {#if $selectedChannelId === activeDmChannel.id && $channelReady}
                                                <MessageList />
                                                <MessageInput />
                                        {:else}
                                                <div class="grid flex-1 place-items-center text-[var(--muted)]">{m.loading()}</div>
                                        {/if}
                                </div>
                        {:else}
                                <div class="flex flex-1 flex-col overflow-y-auto px-6 py-4">
                                        {#if friendActionError}
                                                <p class="mb-3 text-sm text-[var(--danger)]">{friendActionError}</p>
                                        {/if}
                                        {#if activeList === 'friends'}
                                                {#if friends.length > 0}
                                                        <div class="space-y-3">
                                                                <div class="flex flex-wrap items-center justify-between gap-2">
                                                                        <h2 class="text-lg font-semibold">{m.user_home_friends_heading()}</h2>
                                                                        <div class="flex gap-2">
                                                                                <button
                                                                                        type="button"
                                                                                        class={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:outline-none ${
                                                                                                friendPresenceFilter === 'online'
                                                                                                        ? 'border-[var(--brand)] bg-[var(--panel)] text-[var(--text-strong)]'
                                                                                                        : 'border-[var(--stroke)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--brand)]/40 hover:text-[var(--text)]'
                                                                                        }`}
                                                                                        aria-pressed={friendPresenceFilter === 'online'}
                                                                                        onclick={() => (friendPresenceFilter = 'online')}
                                                                                >
                                                                                        {m.user_home_friends_tab_online()}
                                                                                </button>
                                                                                <button
                                                                                        type="button"
                                                                                        class={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:outline-none ${
                                                                                                friendPresenceFilter === 'all'
                                                                                                        ? 'border-[var(--brand)] bg-[var(--panel)] text-[var(--text-strong)]'
                                                                                                        : 'border-[var(--stroke)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--brand)]/40 hover:text-[var(--text)]'
                                                                                        }`}
                                                                                        aria-pressed={friendPresenceFilter === 'all'}
                                                                                        onclick={() => (friendPresenceFilter = 'all')}
                                                                                >
                                                                                        {m.user_home_friends_tab_all()}
                                                                                </button>
                                                                        </div>
                                                                </div>
                                                                <div>
                                                                        <label class="sr-only" for={friendFilterInputId}>
                                                                                {m.user_home_friends_filter_label()}
                                                                        </label>
                                                                        <input
                                                                                id={friendFilterInputId}
                                                                                class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:outline-none"
                                                                                type="search"
                                                                                bind:value={friendFilter}
                                                                                placeholder={m.user_home_friends_filter_placeholder()}
                                                                        />
                                                                </div>
                                                                {#if filteredFriends.length > 0}
                                                                        <div class="grid gap-3">
                                                                                {#each filteredFriends as friend (friend.id)}
                                                                                        {@const isOpening = openingDmChannelIds.has(friend.id)}
                                                                                        {@const isActiveFriend = activeDmTargetId === friend.id}
                                                                                        {@const friendPresence = $presenceMap[friend.id] ?? null}
                                                                                        {@const friendPresenceStatus = friendPresence?.status ?? null}
                                                                                        {@const friendCustomStatus = friendPresence?.customStatusText ?? null}
                                                                                        <div
                                                                                                class="flex items-center gap-2"
                                                                                                use:customContextMenuTarget
                                                                                                oncontextmenu={(event) =>
                                                                                                        openFriendContextMenu(
                                                                                                                event,
                                                                                                                friend
                                                                                                        )
                                                                                                }
                                                                                        >
                                                                                                <button
                                                                                                        type="button"
                                                                                                        class={`flex flex-1 items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
                                                                                                                isActiveFriend
                                                                                                                        ? 'border-[var(--brand)] bg-[var(--panel)] text-[var(--text-strong)]'
                                                                                                                        : 'border-[var(--stroke)] bg-[var(--panel-strong)] hover:border-[var(--brand)]/40 hover:bg-[var(--panel)]'
                                                                                                        } ${isOpening ? 'cursor-wait opacity-70' : ''}`}
                                                                                                        disabled={isOpening}
                                                                                                        aria-busy={isOpening}
                                                                                                        onclick={() => handleFriendOpenDirectChannel(friend)}
                                                                                                >
                                                                                                        <div class="relative">
                                                                                                                <div class="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[var(--panel)] text-sm font-semibold">
                                                                                                                        {#if friend.avatarUrl}
                                                                                                                                <img alt={friend.name} class="h-full w-full object-cover" src={friend.avatarUrl} />
                                                                                                                        {:else}
                                                                                                                                <span>{initialsFor(friend.name)}</span>
                                                                                                                        {/if}
                                                                                                                </div>
                                                                                                                <span
                                                                                                                        class={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${presenceIndicatorClass(friendPresenceStatus)}`}
                                                                                                                ></span>
                                                                                                        </div>
                                                                                                        <div class="min-w-0 flex-1">
                                                                                                                <div class="truncate text-sm font-semibold">{friend.name}</div>
                                                                                                                {#if friendCustomStatus}
                                                                                                                        <div class="truncate text-xs text-[var(--muted)]">{friendCustomStatus}</div>
                                                                                                                {/if}
                                                                                                        </div>
                                                                                                </button>
                                                                                                <button
                                                                                                        type="button"
                                                                                                        class="rounded-md border border-[var(--stroke)] px-2 py-1 text-xs font-medium text-[var(--danger)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                                        onclick={() => handleRemoveFriend(friend.id)}
                                                                                                        disabled={removingFriendIds.has(friend.id)}
                                                                                                >
                                                                                                        {m.user_home_friend_remove()}
                                                                                                </button>
                                                                                        </div>
                                                                                {/each}
                                                                        </div>
                                                                {:else}
                                                                        <p class="text-sm text-[var(--muted)]">{m.user_home_friends_filter_empty()}</p>
                                                                {/if}
                                                        </div>
                                                {:else}
                                                        <h2 class="mb-4 text-lg font-semibold">{m.user_home_friends_heading()}</h2>
                                                        <p class="text-sm text-[var(--muted)]">{m.user_home_friends_empty()}</p>
                                                {/if}
                                        {:else if friendRequests.length > 0}
                                                <h2 class="mb-4 text-lg font-semibold">{m.user_home_requests_heading()}</h2>
                                                <div class="grid gap-3">
                                                        {#each friendRequests as request (request.id)}
                                                                <div
                                                                        class="flex flex-wrap items-center gap-3 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
                                                                >
                                                                        <div class="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[var(--panel)] text-sm font-semibold">
                                                                                {#if request.avatarUrl}
                                                                                        <img alt={request.name} class="h-full w-full object-cover" src={request.avatarUrl} />
                                                                                {:else}
                                                                                        <span>{initialsFor(request.name)}</span>
                                                                                {/if}
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
                                                                                                onclick={() => handleFriendRequest(request.id, 'decline')}
                                                                                                disabled={processingRequestIds.has(request.id)}
                                                                                        >
                                                                                                {m.user_home_friend_cancel()}
                                                                                        </button>
                                                                                {:else}
                                                                                        <button
                                                                                                type="button"
                                                                                                class="rounded-md bg-[var(--brand)] px-2 py-1 text-xs font-semibold text-[var(--bg)] transition hover:bg-[var(--brand-strong)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                                onclick={() => handleFriendRequest(request.id, 'accept')}
                                                                                                disabled={processingRequestIds.has(request.id)}
                                                                                        >
                                                                                                {m.user_home_friend_accept()}
                                                                                        </button>
                                                                                        <button
                                                                                                type="button"
                                                                                                class="rounded-md border border-[var(--stroke)] px-2 py-1 text-xs font-medium text-[var(--danger)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                                                                onclick={() => handleFriendRequest(request.id, 'decline')}
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
                                                <h2 class="mb-4 text-lg font-semibold">{m.user_home_requests_heading()}</h2>
                                                <p class="text-sm text-[var(--muted)]">{m.user_home_requests_empty()}</p>
                                        {/if}
                                </div>
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
                tabindex="-1"
                onclick={handleAddFriendBackdropClick}
                onkeydown={(event) => {
                        if (event.key === 'Escape') {
                                closeAddFriendModal();
                        }
                }}
        >
                <div aria-hidden="true" class="absolute inset-0 bg-black/50"></div>
                <div class="relative z-10 w-full max-w-sm rounded-lg backdrop-blur-md">
                        <div
                                class="rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)]/90 p-6 shadow-xl"
                                role="document"
                        >
                                <h2 id="user-screen-add-friend-title" class="text-lg font-semibold text-[var(--text-strong)]">
                                        {m.user_home_add_friend_title()}
                                </h2>
                                <form
                                        class="mt-4 space-y-4"
                                        aria-busy={isSubmittingAddFriend}
                                        onsubmit={(event) => {
                                                event.preventDefault();
                                                handleAddFriendSubmit();
                                        }}
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
                                                        onclick={closeAddFriendModal}
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
        </div>
{/if}

<svelte:window onkeydown={handleWindowKeydown} />
