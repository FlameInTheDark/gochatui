<script lang="ts">
        import type { DtoMessage, MessageApiMessageChannelChannelIdGetRequest } from '$lib/api';
        import { auth } from '$lib/stores/auth';
        import {
                selectedChannelId,
                channelsByGuild,
                selectedGuildId,
                channelReady,
                messageJumpRequest,
                membersByGuild
        } from '$lib/stores/appState';
        import MessageItem from './MessageItem.svelte';
        import MessagePlaceholder from './MessagePlaceholder.svelte';
        import { applyMessageEventToList } from './messageEventHandlers';
        import { wsEvent } from '$lib/client/ws';
        import { m as i18n } from '$lib/paraglide/messages.js';
        import { fly } from 'svelte/transition';
        import { onDestroy, onMount, tick, untrack } from 'svelte';
        import { Sparkles } from 'lucide-svelte';
        import { pendingMessages } from '$lib/stores/pendingMessages';
        import PendingMessageItem from './PendingMessageItem.svelte';
        import {
                guildChannelReadStateLookup,
                dmChannelMetadataLookup,
                mutateAppSettingsWithoutSaving,
                type GuildChannelReadState,
                type GuildLayoutGuild,
                type GuildLayoutItem
        } from '$lib/stores/settings';
        import { acknowledgeChannelRead } from '$lib/stores/unread';
        import { isMessageNewer } from './readStateUtils';
        import { channelTypingUsers } from '$lib/stores/channelTyping';
        import { tooltip } from '$lib/actions/tooltip';
        import { memberPrimaryName, toSnowflakeString } from '$lib/utils/members';

	let messages = $state<DtoMessage[]>([]);
        let loading = $state(false);
        let loadingDirection = $state<'none' | 'older' | 'newer'>('none');
	let error = $state<string | null>(null);
        let endReached = $state(false);
        let latestReached = $state(true);

        let scroller: HTMLDivElement | null = null;
        let wasAtBottom = $state(false);
        let newCount = $state(0);
        let initialLoaded = $state(false);
        let channelSwitchToken = 0;
        let jumpRequestToken = 0;

        const READ_STATE_FLUSH_INTERVAL = 60_000;
        const me = auth.user;
        const typingUsersLookup = channelTypingUsers;

        interface PendingReadState {
                guildId: string;
                channelId: string;
                lastReadMessageId: string | null;
                scrollPosition: number;
        }

        interface PersistedReadState {
                lastReadMessageId: string | null;
                scrollPosition: number;
        }

        const pendingReadStates = new Map<string, PendingReadState>();
        const lastPersistedReadStates = new Map<string, PersistedReadState>();
        const dirtyGuilds = new Set<string>();
        let readStateFlushTimer: ReturnType<typeof setInterval> | null = null;
        let activeGuildId: string | null = null;
        let activeChannelId: string | null = null;
        let previousChannelKey: string | null = null;
        let initializedChannelKey: string | null = null;
        let initializingChannelKey: string | null = null;
        let lastVisibleMessageId = $state<string | null>(null);
        let activeChannelReadMarker = $state<string | null>(null);
        let unreadSeparatorMarker = $state<string | null>(null);

        const ACK_DEBOUNCE_MS = 2_000;
        let ackTimer: ReturnType<typeof setTimeout> | null = null;
        let scheduledAckKey: string | null = null;
        let lastAckedKey: string | null = null;
        let ackInFlightKey: string | null = null;

        function findGuildLayoutEntry(layout: GuildLayoutItem[], guildId: string): GuildLayoutGuild | null {
                for (const item of layout) {
                        if (item.kind === 'guild') {
                                if (item.guildId === guildId) return item;
                                continue;
                        }
                        for (const guild of item.guilds) {
                                if (guild.guildId === guildId) return guild;
                        }
                }
                return null;
        }

        function computeLastVisibleMessageId(): string | null {
                if (!scroller) return null;
                const scrollerRect = scroller.getBoundingClientRect();
                const nodes = scroller.querySelectorAll<HTMLElement>('[data-message-id]');
                let lastVisible: string | null = null;
                for (const node of nodes) {
                        const rect = node.getBoundingClientRect();
                        const isVisible = rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom;
                        if (!isVisible) continue;
                        const id = node.getAttribute('data-message-id');
                        if (id) {
                                lastVisible = id;
                        }
                }
                return lastVisible;
        }

        function recordReadState() {
                if (!initialLoaded) return;
                const gid = activeGuildId ?? '';
                const cid = activeChannelId ?? '';
                if (!gid || !cid) return;
                if (!scroller) return;
                const lastVisibleId = computeLastVisibleMessageId();
                lastVisibleMessageId = lastVisibleId ?? null;
                const scrollPosition = Math.max(0, Math.round(scroller.scrollTop));
                const key = `${gid}:${cid}`;
                const nextState: PendingReadState = {
                        guildId: gid,
                        channelId: cid,
                        lastReadMessageId: lastVisibleId ?? null,
                        scrollPosition
                };
                const prev = pendingReadStates.get(key);
                if (
                        prev &&
                        prev.lastReadMessageId === nextState.lastReadMessageId &&
                        prev.scrollPosition === nextState.scrollPosition
                ) {
                        return;
                }
                pendingReadStates.set(key, nextState);
                const persisted = lastPersistedReadStates.get(key);
                if (
                        !persisted ||
                        persisted.lastReadMessageId !== nextState.lastReadMessageId ||
                        persisted.scrollPosition !== nextState.scrollPosition
                ) {
                        dirtyGuilds.add(gid);
                }
        }

        function flushPendingReadStates() {
                if (!dirtyGuilds.size) return;
                const updatesByGuild = new Map<string, PendingReadState[]>();
                for (const state of pendingReadStates.values()) {
                        if (!dirtyGuilds.has(state.guildId)) continue;
                        const list = updatesByGuild.get(state.guildId);
                        if (list) {
                                list.push(state);
                        } else {
                                updatesByGuild.set(state.guildId, [state]);
                        }
                }
                if (!updatesByGuild.size) {
                        dirtyGuilds.clear();
                        return;
                }
                mutateAppSettingsWithoutSaving((settings) => {
                        let changed = false;
                        for (const [guildId, states] of updatesByGuild) {
                                if (guildId === '@me') {
                                        if (!Array.isArray(settings.dmChannels) || !settings.dmChannels.length) {
                                                continue;
                                        }
                                        const nextDmChannels = settings.dmChannels.map((entry) => ({
                                                channelId: entry.channelId,
                                                userId: entry.userId,
                                                isDead: entry.isDead ?? false,
                                                lastReadMessageId: entry.lastReadMessageId ?? null,
                                                hidden: entry.hidden ?? false,
                                                hiddenAfterMessageId: entry.hiddenAfterMessageId ?? null
                                        }));
                                        let dmChanged = false;
                                        for (const state of states) {
                                                const idx = nextDmChannels.findIndex(
                                                        (entry) => entry.channelId === state.channelId
                                                );
                                                if (idx === -1) continue;
                                                const current = nextDmChannels[idx];
                                                const nextLastRead = state.lastReadMessageId ?? null;
                                                if ((current.lastReadMessageId ?? null) === nextLastRead) {
                                                        continue;
                                                }
                                                nextDmChannels[idx] = {
                                                        ...current,
                                                        lastReadMessageId: nextLastRead
                                                };
                                                dmChanged = true;
                                        }
                                        if (dmChanged) {
                                                settings.dmChannels = nextDmChannels;
                                                changed = true;
                                        }
                                        continue;
                                }
                                const entry = findGuildLayoutEntry(settings.guildLayout, guildId);
                                if (!entry) continue;
                                const existing = Array.isArray(entry.readStates) ? [...entry.readStates] : [];
                                const stateMap = new Map<string, GuildChannelReadState>();
                                for (const state of existing) {
                                        stateMap.set(state.channelId, { ...state });
                                }
                                let guildChanged = false;
                                for (const state of states) {
                                        const current = stateMap.get(state.channelId);
                                        const next: GuildChannelReadState = {
                                                channelId: state.channelId,
                                                lastReadMessageId: state.lastReadMessageId,
                                                scrollPosition: state.scrollPosition
                                        };
                                        if (
                                                current &&
                                                current.lastReadMessageId === next.lastReadMessageId &&
                                                current.scrollPosition === next.scrollPosition
                                        ) {
                                                continue;
                                        }
                                        stateMap.set(state.channelId, next);
                                        guildChanged = true;
                                }
                                if (guildChanged) {
                                        entry.readStates = Array.from(stateMap.values());
                                        changed = true;
                                }
                        }
                        return changed;
                });
                for (const [guildId, states] of updatesByGuild) {
                        for (const state of states) {
                                const key = `${state.guildId}:${state.channelId}`;
                                lastPersistedReadStates.set(key, {
                                        lastReadMessageId: state.lastReadMessageId,
                                        scrollPosition: state.scrollPosition
                                });
                                if (
                                        state.guildId === (activeGuildId ?? '') &&
                                        state.channelId === (activeChannelId ?? '')
                                ) {
                                        activeChannelReadMarker = state.lastReadMessageId ?? null;
                                }
                                acknowledgeChannelRead(state.guildId, state.channelId);
                        }
                        dirtyGuilds.delete(guildId);
                }
        }

        function buildAckKey(guildId: string, channelId: string, messageId: string | null): string | null {
                if (!guildId || !channelId || !messageId) return null;
                return `${guildId}:${channelId}:${messageId}`;
        }

        function clearAckTimer() {
                if (ackTimer) {
                        clearTimeout(ackTimer);
                        ackTimer = null;
                }
                scheduledAckKey = null;
        }

        function scheduleAck(guildId: string, channelId: string, messageId: string) {
                const key = buildAckKey(guildId, channelId, messageId);
                if (!key) return;
                if (lastAckedKey === key || scheduledAckKey === key || ackInFlightKey === key) {
                        return;
                }
                clearAckTimer();
                ackTimer = setTimeout(() => {
                        void runAck(guildId, channelId, messageId, key);
                }, ACK_DEBOUNCE_MS);
                scheduledAckKey = key;
        }

        function updateReadMarkersAfterAck(guildId: string, channelId: string, messageId: string) {
                if (!guildId || !channelId || !messageId) return;
                const key = `${guildId}:${channelId}`;
                const pending = pendingReadStates.get(key);
                const persisted = lastPersistedReadStates.get(key);
                const scrollPosition = pending?.scrollPosition ?? persisted?.scrollPosition ?? 0;
                const nextPending: PendingReadState = {
                        guildId,
                        channelId,
                        lastReadMessageId: messageId,
                        scrollPosition
                };
                pendingReadStates.set(key, nextPending);
                lastPersistedReadStates.set(key, {
                        lastReadMessageId: messageId,
                        scrollPosition
                });
                dirtyGuilds.add(guildId);
                if (guildId === (activeGuildId ?? '') && channelId === (activeChannelId ?? '')) {
                        activeChannelReadMarker = messageId;
                        unreadSeparatorMarker = null;
                }
        }

        async function runAck(
                guildId: string,
                channelId: string,
                messageId: string,
                key: string
        ) {
                ackTimer = null;
                scheduledAckKey = null;
                ackInFlightKey = key;
                let success = false;
                try {
                        await auth.api.message.messageChannelChannelIdMessageIdAckPost({
                                channelId: channelId as any,
                                messageId: messageId as any
                        });
                        success = true;
                } catch (error) {
                        console.error('Failed to acknowledge channel read', error);
                } finally {
                        if (ackInFlightKey === key) {
                                ackInFlightKey = null;
                        }
                        if (success) {
                                lastAckedKey = key;
                                updateReadMarkersAfterAck(guildId, channelId, messageId);
                                if (guildId) {
                                        acknowledgeChannelRead(guildId, channelId);
                                }
                        } else if (
                                wasAtBottom &&
                                guildId === (activeGuildId ?? '') &&
                                channelId === (activeChannelId ?? '') &&
                                lastVisibleMessageId === messageId
                        ) {
                                scheduleAck(guildId, channelId, messageId);
                        }
                }
        }

        onMount(() => {
                if (readStateFlushTimer) clearInterval(readStateFlushTimer);
                readStateFlushTimer = setInterval(() => {
                        flushPendingReadStates();
                }, READ_STATE_FLUSH_INTERVAL);
        });

        onDestroy(() => {
                if (readStateFlushTimer) {
                        clearInterval(readStateFlushTimer);
                        readStateFlushTimer = null;
                }
                clearAckTimer();
                flushPendingReadStates();
        });

        $effect(() => {
                if (!initialLoaded) return;
                const dependencies = {
                        count: messages.length,
                        wasAtBottom,
                        endReached,
                        latestReached,
                        newCount
                };
                void dependencies;
                queueMicrotask(() => {
                        recordReadState();
                });
        });

        $effect(() => {
                const gid = $selectedGuildId;
                const cid = $selectedChannelId;
                activeGuildId = gid;
                activeChannelId = cid;
                const key = gid && cid ? `${gid}:${cid}` : null;
                if (previousChannelKey && previousChannelKey !== key) {
                        flushPendingReadStates();
                }
                if (previousChannelKey !== key) {
                        clearAckTimer();
                        ackInFlightKey = null;
                        lastAckedKey = null;
                        lastVisibleMessageId = null;
                        activeChannelReadMarker = null;
                        unreadSeparatorMarker = null;
                }
                previousChannelKey = key;
        });

        $effect(() => {
                const gid = activeGuildId ?? '';
                const cid = activeChannelId ?? '';
                const lookup = $guildChannelReadStateLookup;
                if (!gid || !cid) {
                        activeChannelReadMarker = null;
                        unreadSeparatorMarker = null;
                        return;
                }
                const key = `${gid}:${cid}`;
                const persisted = lastPersistedReadStates.get(key);
                const nextMarker =
                        persisted?.lastReadMessageId ?? lookup?.[gid]?.[cid]?.lastReadMessageId ?? null;
                activeChannelReadMarker = nextMarker;
        });

        $effect(() => {
                const atBottom = wasAtBottom;
                const messageId = lastVisibleMessageId;
                const gid = $selectedGuildId ?? '';
                const cid = $selectedChannelId ?? '';
                const lookup = $guildChannelReadStateLookup;
                const dmLookup = $dmChannelMetadataLookup;
                if (!atBottom || !gid || !cid || !messageId) {
                        clearAckTimer();
                        return;
                }
                if (gid === '@me') {
                        const metadata = dmLookup?.[cid] ?? null;
                        if (metadata?.isDead) {
                                clearAckTimer();
                                return;
                        }
                }
                const key = `${gid}:${cid}`;
                const persisted = lastPersistedReadStates.get(key);
                const lastReadMarker =
                        persisted?.lastReadMessageId ?? lookup?.[gid]?.[cid]?.lastReadMessageId ?? activeChannelReadMarker;
                if (!isMessageNewer(messageId, lastReadMarker)) {
                        clearAckTimer();
                        return;
                }
                scheduleAck(gid, cid, messageId);
        });

	function isNearBottom() {
		if (!scroller) return true;
		const distance = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
		return distance < 80;
	}

        function scrollToBottom(smooth = false) {
                if (!scroller) return;
                requestAnimationFrame(() => {
                        scroller!.scrollTo({ top: scroller!.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
                });
        }

        function isNearTop() {
                if (!scroller) return false;
                return scroller.scrollTop <= 64;
        }

	function toDate(s?: string): Date | null {
		if (!s) return null;
		const d = new Date(s);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	function sameDay(a: Date, b: Date) {
		return (
			a.getFullYear() === b.getFullYear() &&
			a.getMonth() === b.getMonth() &&
			a.getDate() === b.getDate()
		);
	}
	function humanDate(d: Date) {
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		if (sameDay(d, now)) return 'Today';
		if (sameDay(d, yesterday)) return 'Yesterday';
		return new Intl.DateTimeFormat(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		}).format(d);
	}

	function authorKey(a: any): string | null {
		if (a == null) return null;
		const t = typeof a;
		if (t === 'number' || t === 'string') return String(a);
		if (t === 'object') {
			if ((a as any).id != null) return String((a as any).id);
			if ((a as any).name) return String((a as any).name);
		}
		return null;
	}

        $effect(() => {
                const channelId = $selectedChannelId;
                const ready = $channelReady;
                const gid = $selectedGuildId ?? '';
                if (!channelId) {
                        error = null;
                        messages = [];
                        endReached = false;
                        latestReached = false;
                        initialLoaded = false;
                        initializedChannelKey = null;
                        initializingChannelKey = null;
                        unreadSeparatorMarker = null;
                        return;
                }
                if (!ready) {
                        loading = false;
                        error = null;
                        initializingChannelKey = null;
                        unreadSeparatorMarker = null;
                        return;
                }
                const key = `${gid}:${channelId}`;
                if (
                        initializedChannelKey === key &&
                        (initialLoaded || initializingChannelKey === key)
                ) {
                        return;
                }
                const list = $channelsByGuild[gid] ?? [];
                const chan = list.find((c: any) => String(c?.id) === channelId);
                if (!chan) return;
                if ((chan as any)?.type === 2) return;
                initializedChannelKey = key;
                messages = [];
                endReached = false;
                latestReached = false;
                initialLoaded = false;
                unreadSeparatorMarker = null;
                const token = ++channelSwitchToken;
                const pendingJump = untrack(() => $messageJumpRequest);
                if (pendingJump && pendingJump.channelId === channelId) {
                        return;
                }
                initializingChannelKey = key;
                const lookup = untrack(() => $guildChannelReadStateLookup);
                const lastReadMessageId = lookup?.[gid]?.[channelId]?.lastReadMessageId ?? null;
                const lastKnownMessageId = getChannelLastMessageId(chan);
                const shouldLoadAround =
                        Boolean(lastReadMessageId && lastKnownMessageId) &&
                        isMessageNewer(lastKnownMessageId, lastReadMessageId);
                unreadSeparatorMarker = shouldLoadAround ? lastReadMessageId : null;
                (async () => {
                        try {
                                if (shouldLoadAround) {
                                        const jumped = await jumpToMessage(lastReadMessageId);
                                        if (!jumped && messages.length === 0) {
                                                await loadLatest();
                                        }
                                } else {
                                        await loadLatest();
                                }
                                if (token === channelSwitchToken && !initialLoaded) {
                                        initialLoaded = true;
                                        await tick();
                                        recordReadState();
                                }
                        } finally {
                                if (token === channelSwitchToken) {
                                        initializingChannelKey = null;
                                }
                        }
                })();
        });

        const PAGE_SIZE = 50;
        const PLACEHOLDER_COUNT = 3;
        const placeholders = Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => i);

        const typingIndicator = $derived.by(() => {
                const channelId = $selectedChannelId ?? '';
                if (!channelId) return null;
                const lookup = $typingUsersLookup;
                const rawIds = Array.isArray(lookup?.[channelId]) ? lookup[channelId] : [];
                if (rawIds.length === 0) return null;

                const normalizedIds: string[] = [];
                for (const value of rawIds) {
                        const normalized = toSnowflakeString(value);
                        if (!normalized) continue;
                        if (!normalizedIds.includes(normalized)) {
                                normalizedIds.push(normalized);
                        }
                }

                if (!normalizedIds.length) return null;
                const selfId = toSnowflakeString(($me as any)?.id);
                const filtered = normalizedIds.filter((id) => id !== selfId);
                if (!filtered.length) return null;

                const names: string[] = [];
                for (const id of filtered) {
                        const name = resolveTypingName(channelId, id);
                        if (!name) continue;
                        names.push(name);
                }
                if (!names.length) return null;

                const visible = names.slice(0, 3);
                const hidden = names.slice(3);
                const text = formatTypingText(visible, hidden.length);
                if (!text) return null;

                return {
                        text,
                        tooltip: names.join(', '),
                        hasTooltip: hidden.length > 0
                };
        });

        function extractId(value: any): string | null {
                if (value == null) return null;
                const raw = typeof value === 'object' ? ((value as any)?.id ?? value) : value;
                if (raw == null) return null;
                const str = String(raw);
                const digits = str.replace(/[^0-9]/g, '');
                return digits || str;
        }

        function compareMessageIds(a: string, b: string): number {
                if (a === b) return 0;
                const digitsA = /^\d+$/.test(a);
                const digitsB = /^\d+$/.test(b);
                if (digitsA && digitsB) {
                        try {
                                const ai = BigInt(a);
                                const bi = BigInt(b);
                                if (ai < bi) return -1;
                                if (ai > bi) return 1;
                                return 0;
                        } catch {
                                if (a.length !== b.length) {
                                        return a.length - b.length;
                                }
                        }
                }
                return a.localeCompare(b);
        }

        function sortMessagesAscending(list: DtoMessage[]): DtoMessage[] {
                return [...list].sort((a, b) => {
                        const ak = extractId(a);
                        const bk = extractId(b);
                        if (ak && bk) return compareMessageIds(ak, bk);
                        if (ak) return -1;
                        if (bk) return 1;
                        return 0;
                });
        }

        function mergeMessageLists(base: DtoMessage[], incoming: DtoMessage[]): DtoMessage[] {
                if (!incoming.length) return base.slice();
                const map = new Map<string, DtoMessage>();
                for (const msg of base) {
                        const key = extractId(msg);
                        if (!key) continue;
                        map.set(key, msg);
                }
                for (const msg of incoming) {
                        const key = extractId(msg);
                        if (!key) continue;
                        const prev = map.get(key);
                        map.set(key, prev ? { ...prev, ...msg } : msg);
                }
                const merged = Array.from(map.entries())
                        .sort((a, b) => compareMessageIds(a[0], b[0]))
                        .map(([, value]) => value);
                return merged;
        }

        function formatUserDisplayName(candidate: any): string | null {
                if (!candidate || typeof candidate !== 'object') return null;
                const fields = [
                        candidate.global_name,
                        candidate.globalName,
                        candidate.display_name,
                        candidate.displayName,
                        candidate.username,
                        candidate.name,
                        candidate.nick,
                        candidate.nickname
                ];
                for (const field of fields) {
                        if (typeof field !== 'string') continue;
                        const trimmed = field.trim();
                        if (trimmed) {
                                return trimmed;
                        }
                }
                return null;
        }

        function resolveNameFromGuildMembers(guildId: string, userId: string): string | null {
                if (!guildId || guildId === '@me') return null;
                const list = $membersByGuild[guildId];
                if (!Array.isArray(list)) return null;
                for (const entry of list) {
                        const memberId =
                                toSnowflakeString((entry as any)?.user?.id) ?? toSnowflakeString((entry as any)?.id);
                        if (memberId !== userId) continue;
                        const name = memberPrimaryName(entry);
                        if (name) return name;
                        const fallback = formatUserDisplayName((entry as any)?.user);
                        if (fallback) return fallback;
                        break;
                }
                return null;
        }

        function resolveNameFromDmChannel(channelId: string, userId: string): string | null {
                if (!channelId) return null;
                const dmChannels = $channelsByGuild['@me'] ?? [];
                const channel = dmChannels.find((candidate) => toSnowflakeString((candidate as any)?.id) === channelId);
                if (!channel) return null;
                const recipients = Array.isArray((channel as any)?.recipients)
                        ? ((channel as any).recipients as any[])
                        : [];
                for (const recipient of recipients) {
                        const rid = toSnowflakeString((recipient as any)?.id);
                        if (rid === userId) {
                                const name = formatUserDisplayName(recipient);
                                if (name) return name;
                        }
                }
                const directRecipient = toSnowflakeString(
                        (channel as any)?.recipient_id ?? (channel as any)?.recipientId
                );
                if (directRecipient === userId) {
                        const name = formatUserDisplayName((channel as any)?.recipient);
                        if (name) return name;
                }
                return null;
        }

        function resolveNameFromMessages(channelId: string, userId: string): string | null {
                for (let i = messages.length - 1; i >= 0; i--) {
                        const entry = messages[i] as any;
                        const authorId =
                                toSnowflakeString(entry?.author_id) ??
                                toSnowflakeString(entry?.authorId) ??
                                toSnowflakeString(entry?.author?.id);
                        if (authorId !== userId) continue;
                        const name = formatUserDisplayName(entry?.author);
                        if (name) return name;
                }
                return null;
        }

        function fallbackTypingName(userId: string): string {
                if (!userId) return 'Someone';
                const suffix = userId.slice(-4);
                return `User ${suffix}`;
        }

        function resolveTypingName(channelId: string, userId: string): string {
                const guildId = $selectedGuildId ?? '';
                if (guildId && guildId !== '@me') {
                        const fromMembers = resolveNameFromGuildMembers(guildId, userId);
                        if (fromMembers) return fromMembers;
                } else {
                        const dmName = resolveNameFromDmChannel(channelId, userId);
                        if (dmName) return dmName;
                }
                const fromMessages = resolveNameFromMessages(channelId, userId);
                if (fromMessages) return fromMessages;
                return fallbackTypingName(userId);
        }

        function formatTypingText(visible: string[], hiddenCount: number): string {
                const total = visible.length + hiddenCount;
                if (total === 0) return '';
                if (total === 1) {
                        return `${visible[0]} is typing…`;
                }
                if (hiddenCount === 0) {
                        if (visible.length === 2) {
                                return `${visible[0]} and ${visible[1]} are typing…`;
                        }
                        if (visible.length === 3) {
                                return `${visible[0]}, ${visible[1]}, and ${visible[2]} are typing…`;
                        }
                        return `${visible.join(', ')} are typing…`;
                }
                const othersLabel = `${hiddenCount} other${hiddenCount === 1 ? '' : 's'}`;
                if (visible.length === 1) {
                        return `${visible[0]} and ${othersLabel} are typing…`;
                }
                if (visible.length === 2) {
                        return `${visible[0]}, ${visible[1]}, and ${othersLabel} are typing…`;
                }
                return `${visible[0]}, ${visible[1]}, ${visible[2]}, and ${othersLabel} are typing…`;
        }

        async function scrollToMessageId(id: string, smooth = true): Promise<boolean> {
                if (!scroller) return false;
                await tick();
                const selector = `[data-message-id="${id.replace(/"/g, '\"')}"]`;
                const target = scroller.querySelector<HTMLElement>(selector);
                if (!target) return false;
                const scrollerRect = scroller.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const offset = targetRect.top - scrollerRect.top + scroller.scrollTop - 72;
                const top = Math.max(0, offset);
                scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
                wasAtBottom = false;
                newCount = 0;

                const highlightClass = 'message-jump-highlight';
                target.classList.remove(highlightClass);
                void target.offsetWidth;
                target.classList.add(highlightClass);
                target.addEventListener(
                        'animationend',
                        () => {
                                target.classList.remove(highlightClass);
                        },
                        { once: true }
                );
                return true;
        }

        async function loadMore() {
                if (!$selectedChannelId || loading || endReached || messages.length === 0) return;
                loadingDirection = 'older';
                loading = true;
                const prevHeight = scroller?.scrollHeight ?? 0;
                const prevTop = scroller?.scrollTop ?? 0;
		let inserted = 0;
		let mutatedExisting = false;
		try {
			const from = messages[0]?.id as any;
			const res = await auth.api.message.messageChannelChannelIdGet({
				channelId: $selectedChannelId as any,
				from,
				direction: from ? 'before' : undefined,
				limit: PAGE_SIZE
			});
			const batch = res.data ?? [];
			if (batch.length === 0) {
				endReached = true;
				error = null;
				return;
			}
			const incoming = [...batch].reverse();
			const existingIds = new Map<string, number>();
			for (let i = 0; i < messages.length; i += 1) {
				const key = extractId(messages[i]);
				if (key) existingIds.set(key, i);
			}
			const seenNew = new Set<string>();
			const unique: DtoMessage[] = [];
			for (const item of incoming) {
				const key = extractId(item);
				if (key && existingIds.has(key)) {
					const idx = existingIds.get(key)!;
					messages[idx] = { ...messages[idx], ...item };
					mutatedExisting = true;
					continue;
				}
				if (key) {
					if (seenNew.has(key)) continue;
					seenNew.add(key);
				}
				unique.push(item);
			}
			if (unique.length > 0) {
				messages = [...unique, ...messages];
				inserted = unique.length;
			} else if (mutatedExisting) {
				messages = [...messages];
			}
			if (unique.length === 0 || batch.length < PAGE_SIZE) {
				endReached = true;
			}
			error = null;
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
                } finally {
                        loading = false;
                        loadingDirection = 'none';
                        if (inserted > 0 && scroller) {
                                await tick();
                                const diff = scroller.scrollHeight - prevHeight;
                                if (prevTop > 0) {
                                        scroller.scrollTop = prevTop + diff;
                                }
                        }
                        void tick().then(() => recordReadState());
                }
        }

        async function loadNewer() {
                if (
                        !$selectedChannelId ||
                        loading ||
                        latestReached ||
                        (!initialLoaded && messages.length === 0)
                ) {
                        return;
                }
                if (!messages.length) {
                        await loadLatest();
                        return;
                }
                loadingDirection = 'newer';
                loading = true;
                let mutatedExisting = false;
                try {
                        const last = messages[messages.length - 1];
                        const from = extractId(last);
                        const params: MessageApiMessageChannelChannelIdGetRequest = {
                                channelId: $selectedChannelId as any,
                                limit: PAGE_SIZE
                        };
                        const mutableParams = params as Record<string, any>;
                        if (from) {
                                mutableParams.from = from as any;
                                mutableParams.direction = 'after';
                        }
                        const res = await auth.api.message.messageChannelChannelIdGet(params);
                        const batch = res.data ?? [];
                        if (batch.length === 0) {
                                latestReached = true;
                                error = null;
                                return;
                        }
                        const incoming = sortMessagesAscending(batch);
                        const existingIds = new Map<string, number>();
                        for (let i = 0; i < messages.length; i += 1) {
                                const key = extractId(messages[i]);
                                if (key) existingIds.set(key, i);
                        }
                        const seenNew = new Set<string>();
                        const unique: DtoMessage[] = [];
                        for (const item of incoming) {
                                const key = extractId(item);
                                if (!key) continue;
                                if (existingIds.has(key)) {
                                        const idx = existingIds.get(key)!;
                                        messages[idx] = { ...messages[idx], ...item };
                                        mutatedExisting = true;
                                        continue;
                                }
                                if (seenNew.has(key)) continue;
                                seenNew.add(key);
                                unique.push(item);
                        }
                        if (unique.length > 0) {
                                messages = [...messages, ...unique];
                        } else if (mutatedExisting) {
                                messages = [...messages];
                        }
                        latestReached = unique.length === 0 ? true : batch.length < PAGE_SIZE;
                        error = null;
                } catch (e: any) {
                        error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
                } finally {
                        loading = false;
                        loadingDirection = 'none';
                        void tick().then(() => recordReadState());
                }
        }

        function onSent() {
                loadLatest();
        }

        async function loadLatest() {
                if (!$selectedChannelId) return;
                try {
                        const res = await auth.api.message.messageChannelChannelIdGet({
                                channelId: $selectedChannelId as any,
                                limit: PAGE_SIZE
                        });
                        const batch = res.data ?? [];
                        messages = [...batch].reverse();
                        endReached = batch.length < PAGE_SIZE;
                        latestReached = true;
                        error = null;
                        scrollToBottom(false);
                        wasAtBottom = true;
                        newCount = 0;
                        void tick().then(() => recordReadState());
                } catch (e: any) {
                        error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
                }
        }

        function shouldShowNewSeparator(current: DtoMessage, previous: DtoMessage | undefined): boolean {
                const marker = unreadSeparatorMarker;
                if (!marker) return false;
                const currentId = extractId(current);
                if (!currentId) return false;
                if (!isMessageNewer(currentId, marker)) return false;
                const prevId = previous ? extractId(previous) : null;
                if (!prevId) return true;
                return !isMessageNewer(prevId, marker);
        }

        function getChannelLastMessageId(channel: any): string | null {
                if (!channel) return null;
                const candidates = [
                        (channel as any)?.last_message_id,
                        (channel as any)?.lastMessageId,
                        (channel as any)?.lastMessage?.id,
                        (channel as any)?.last_message?.id,
                        (channel as any)?.lastMessage,
                        (channel as any)?.last_message
                ];
                for (const value of candidates) {
                        const id = extractId(value);
                        if (id) return id;
                }
                return null;
        }

        async function jumpToMessage(targetRaw: any): Promise<boolean> {
                if (!$selectedChannelId) return false;
                const targetId = extractId(targetRaw);
                if (!targetId) return false;
                let fetched = false;
                const hadFutureMessages = messages.some((msg) => {
                        const key = extractId(msg);
                        if (!key) return false;
                        return compareMessageIds(key, targetId) > 0;
                });
                const exists = messages.some((msg) => extractId(msg) === targetId);
                if (!exists) {
                        loading = true;
                        try {
                                const res = await auth.api.message.messageChannelChannelIdGet({
                                        channelId: $selectedChannelId as any,
                                        from: targetId as any,
                                        direction: 'around',
                                        limit: PAGE_SIZE
                                });
                                const batch = res.data ?? [];
                                const normalized = sortMessagesAscending(batch);
                                messages = mergeMessageLists(messages, normalized);
                                endReached = false;
                                error = null;
                                fetched = true;
                        } catch (e: any) {
                                error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
                                return false;
                        } finally {
                                loading = false;
                        }
                        if (!hadFutureMessages) {
                                latestReached = false;
                        }
                } else {
                        error = null;
                }
                initialLoaded = true;
                const scrolled = await scrollToMessageId(targetId, !fetched);
                if (!scrolled && fetched) {
                        error = error ?? 'Failed to load messages';
                }
                void tick().then(() => recordReadState());
                return scrolled;
        }

        $effect(() => {
                const request = $messageJumpRequest;
                if (!request) return;
                if (!$channelReady) return;
                if (request.channelId !== $selectedChannelId) return;
                const targetId = request.messageId;
                if (!targetId) {
                        messageJumpRequest.set(null);
                        return;
                }
                const token = ++jumpRequestToken;
                (async () => {
                        await jumpToMessage(targetId);
                        if (token === jumpRequestToken) {
                                messageJumpRequest.set(null);
                        }
                })();
        });

        export function refresh() {
                loadLatest();
        }

        $effect(() => {
                const ev: any = $wsEvent;
                if (!ev || ev.op !== 0) return;
                untrack(() => {
                        const result = applyMessageEventToList({
                                event: ev,
                                currentMessages: messages,
                                selectedChannelId: $selectedChannelId,
                                wasAtBottom
                        });
                        if (!result) return;
                        messages = result.messages;
                        if (result.newCountDelta !== 0) {
                                newCount = Math.max(0, newCount + result.newCountDelta);
                        }
                        if (result.shouldScrollToBottom) {
                                scrollToBottom(true);
                        }
                });
        });
</script>

<div
    class="scroll-area chat-scroll relative flex-1 overflow-y-auto"
	bind:this={scroller}
        onscroll={() => {
                const nearBottom = isNearBottom();
                wasAtBottom = nearBottom;
                if (nearBottom) newCount = 0;
                if (!loading && !endReached && isNearTop()) {
                        loadMore();
                }
                if (!loading && !latestReached && nearBottom) {
                        loadNewer();
                }
                recordReadState();
        }}
>
        {#if error}
                <div class="border-b border-[var(--stroke)] bg-[var(--panel)] px-4 py-2 text-sm text-red-500">
                        {error}
                </div>
        {/if}
        {#if loading && loadingDirection === 'older'}
                <div class="space-y-2 pb-2" aria-hidden="true">
                        {#each placeholders as key (key)}
                                <MessagePlaceholder />
                        {/each}
                </div>
        {/if}
        {#if endReached && initialLoaded}
                <div class="px-4 py-6">
                        <div
                                class="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-[var(--stroke)] bg-[var(--panel)]/80 p-6 text-center shadow-sm"
                        >
                                <div
                                        class="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-[var(--brand)]"
                                >
                                        <Sparkles aria-hidden="true" class="h-6 w-6" stroke-width={2} />
                                </div>
                                <div>
                                        <p class="text-sm font-medium text-[var(--foreground)]">
                                                {i18n.start_of_history()}
                                        </p>
                                </div>
                        </div>
                </div>
        {/if}
	{#each messages as m, i (m.id)}
		{@const d = (function () {
			const t = (m as any)?.id;
			try {
				const s = String(t).replace(/[^0-9]/g, '');
				if (!s) return toDate(m.updated_at);
				const v = BigInt(s);
				const EPOCH = Date.UTC(2008, 10, 10, 23, 0, 0, 0);
				const ms = Number(v >> 22n);
				return new Date(EPOCH + ms);
			} catch {
				return toDate(m.updated_at);
			}
		})()}
		{@const prevDateForSep = (function () {
			const t = (messages[i - 1] as any)?.id;
			try {
				const s = String(t).replace(/[^0-9]/g, '');
				if (!s) return toDate(messages[i - 1]?.updated_at);
				const v = BigInt(s);
				const EPOCH = Date.UTC(2008, 10, 10, 23, 0, 0, 0);
				const ms = Number(v >> 22n);
				return new Date(EPOCH + ms);
			} catch {
				return toDate(messages[i - 1]?.updated_at);
			}
		})()}
		{@const showDate = d && (!messages[i - 1] || (prevDateForSep && !sameDay(d!, prevDateForSep!)))}
		{#if showDate}
			<div class="my-3 flex items-center justify-center">
				<div
					class="rounded-full border border-[var(--stroke)] bg-[var(--panel)] px-3 py-0.5 text-xs text-[var(--muted)]"
				>
					{humanDate(d!)}
				</div>
			</div>
		{/if}
		{@const prev = messages[i - 1]}
		{@const pk = authorKey((prev as any)?.author)}
		{@const ck = authorKey((m as any)?.author)}
		{@const pd = (function () {
			const t = (prev as any)?.id;
			try {
				const s = String(t).replace(/[^0-9]/g, '');
				if (!s) return toDate(prev?.updated_at);
				const v = BigInt(s);
				const EPOCH = Date.UTC(2008, 10, 10, 23, 0, 0, 0);
				const ms = Number(v >> 22n);
				return new Date(EPOCH + ms);
			} catch {
				return toDate(prev?.updated_at);
			}
		})()}
                {@const withinMinute =
                        pd && d ? Math.abs((d as Date).getTime() - (pd as Date).getTime()) <= 60000 : false}
                {@const compact = pk != null && ck != null && pk === ck && withinMinute}
                {@const showNewSeparator = shouldShowNewSeparator(m, prev)}
                {#if showNewSeparator}
                        <div class="my-4 flex items-center gap-3 pl-3" data-new-message-separator>
                                <div class="h-px flex-1 rounded-full bg-red-500/50"></div>
                                <span class="text-xs font-semibold uppercase tracking-wide text-red-500">
                                        {i18n.new_messages_divider()}
                                </span>
                                <div class="h-px flex-1 rounded-full bg-red-500/50"></div>
                        </div>
                {/if}
                <MessageItem message={m} {compact} on:deleted={loadLatest} />
        {/each}
        {#each $pendingMessages.filter((msg) => msg.channelId === ($selectedChannelId ?? '')) as pending (pending.localId)}
                <PendingMessageItem message={pending} />
        {/each}
        {#if loading && loadingDirection === 'newer'}
                <div class="space-y-2 pt-2" aria-hidden="true">
                        {#each placeholders as key (key)}
                                <MessagePlaceholder />
                        {/each}
                </div>
        {/if}
</div>

{#if typingIndicator}
        {#if typingIndicator.hasTooltip}
                <div
                        class="px-4 pb-3 pt-1 text-xs italic text-[var(--muted)]"
                        use:tooltip={{
                                content: () => typingIndicator.tooltip,
                                placement: 'top',
                                align: 'start'
                        }}
                >
                        {typingIndicator.text}
                </div>
        {:else}
                <div class="px-4 pb-3 pt-1 text-xs italic text-[var(--muted)]">{typingIndicator.text}</div>
        {/if}
{/if}

{#if !wasAtBottom && initialLoaded}
        <div class="pointer-events-none relative">
                <div
                        class="gradient-blur absolute inset-x-0 bottom-0 h-16"
			transition:fly={{ y: 16, duration: 200 }}
		>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
		</div>
		<div
			class="pointer-events-auto absolute right-4 bottom-20"
			transition:fly={{ y: 16, duration: 200 }}
		>
			<button
				class="rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-1 text-sm shadow"
				onclick={() => {
					scrollToBottom(true);
					newCount = 0;
					wasAtBottom = true;
				}}
			>
                                {newCount > 0
                                        ? `${i18n.new_count({ count: newCount })} · ${i18n.jump_to_present()}`
                                        : i18n.jump_to_present()}
			</button>
		</div>
	</div>
{/if}

<style>
	.gradient-blur {
		z-index: 5;
		pointer-events: none;
	}
	.gradient-blur:after,
	.gradient-blur:before,
	.gradient-blur > div {
		position: absolute;
		inset: 0;
	}
	.gradient-blur:before {
		content: '';
		z-index: 1;
		backdrop-filter: blur(0.5px);
		-webkit-backdrop-filter: blur(0.5px) !important;
		mask: linear-gradient(180deg, transparent 0, #000 12.5%, #000 25%, transparent 37.5%);
	}
	.gradient-blur > div:first-of-type {
		z-index: 2;
		backdrop-filter: blur(1px);
		-webkit-backdrop-filter: blur(1px) !important;
		mask: linear-gradient(180deg, transparent 12.5%, #000 25%, #000 37.5%, transparent 50%);
	}
	.gradient-blur > div:nth-of-type(2) {
		z-index: 3;
		backdrop-filter: blur(1.5px);
		-webkit-backdrop-filter: blur(1.5px) !important;
		mask: linear-gradient(180deg, transparent 25%, #000 37.5%, #000 50%, transparent 62.5%);
	}
	.gradient-blur > div:nth-of-type(3) {
		z-index: 4;
		backdrop-filter: blur(3px);
		-webkit-backdrop-filter: blur(3px) !important;
		mask: linear-gradient(180deg, transparent 37.5%, #000 50%, #000 62.5%, transparent 75%);
	}
	.gradient-blur > div:nth-of-type(4) {
		z-index: 5;
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px) !important;
		mask: linear-gradient(180deg, transparent 50%, #000 62.5%, #000 75%, transparent 87.5%);
	}
	.gradient-blur > div:nth-of-type(5) {
		z-index: 6;
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px) !important;
		mask: linear-gradient(180deg, transparent 62.5%, #000 75%, #000 87.5%, transparent);
	}
	.gradient-blur > div:nth-of-type(6) {
		z-index: 7;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px) !important;
		mask: linear-gradient(180deg, transparent 75%, #000 87.5%, #000);
	}
        .gradient-blur:after {
                content: '';
                z-index: 8;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px) !important;
                mask: linear-gradient(180deg, transparent 87.5%, #000);
        }

        .chat-scroll {
                scrollbar-gutter: stable;
                scrollbar-width: thin;
                scrollbar-color: transparent transparent;
        }

        .chat-scroll:hover {
                scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
        }

        .chat-scroll::-webkit-scrollbar {
                width: 10px;
                height: 10px;
                background: transparent;
        }

        .chat-scroll::-webkit-scrollbar-button {
                width: 0;
                height: 0;
                display: none;
        }

        .chat-scroll::-webkit-scrollbar-thumb {
                background-color: transparent;
                border-radius: 9999px;
        }

        .chat-scroll:hover::-webkit-scrollbar-thumb {
                background-color: rgba(255, 255, 255, 0.25);
        }

        .chat-scroll::-webkit-scrollbar-track {
                background: transparent;
        }

        @keyframes message-jump-highlight {
                0% {
                        background-color: rgba(249, 115, 22, 0.75);
                }
                60% {
                        background-color: rgba(249, 115, 22, 0.28);
                }
                100% {
                        background-color: transparent;
                }
        }

        :global(.message-jump-highlight) {
                animation: message-jump-highlight 1.4s ease-out;
        }
</style>
