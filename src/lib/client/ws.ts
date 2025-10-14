import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';
import type { DtoChannel } from '$lib/api';
import { auth } from '$lib/stores/auth';
import {
        channelRolesByGuild,
        channelsByGuild,
        lastChannelByGuild,
        membersByGuild,
        messagesByChannel,
        myGuildRoleIdsByGuild,
        appHasFocus,
        selectedChannelId,
        selectedGuildId
} from '$lib/stores/appState';
import { markChannelUnread } from '$lib/stores/unread';
import { browser } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { getRuntimeConfig } from '$lib/runtime/config';
import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
import { addVisibleDmChannel } from '$lib/stores/settings';
import { isFriendId, markFriendRemoved, triggerFriendDataRefresh } from '$lib/stores/friends';

type AnyRecord = Record<string, any>;

interface WSGlobalState {
        wsConnected: Writable<boolean>;
        wsConnectionLost: Writable<boolean>;
        wsEvent: Writable<AnyRecord | null>;
        wsAuthenticated: Writable<boolean>;
        socket: WebSocket | null;
        hbTimer: ReturnType<typeof setInterval> | null;
        hbWorker: Worker | null;
        hbWorkerActive: boolean;
        heartbeatMs: number;
        lastT: number;
        authed: boolean;
        lastHeartbeatE: number;
        reconnectTimer: ReturnType<typeof setTimeout> | null;
        shouldReconnect: boolean;
        latestToken: string | null;
        heartbeatSessionId: string | null;
        subscriptionsRegistered: boolean;
        cleanupSubscribers: (() => void) | null;
}

declare global {
        // eslint-disable-next-line no-var
        var __GOCHAT_WS_STATE__: WSGlobalState | undefined;
        interface Window {
                __GOCHAT_WS_STATE__?: WSGlobalState;
        }
}

const globalScope = globalThis as typeof globalThis & { __GOCHAT_WS_STATE__?: WSGlobalState };

const wsState: WSGlobalState =
        globalScope.__GOCHAT_WS_STATE__ ??
        (globalScope.__GOCHAT_WS_STATE__ = {
                wsConnected: writable(false),
                wsConnectionLost: writable(false),
                wsEvent: writable<AnyRecord | null>(null),
                wsAuthenticated: writable(false),
                socket: null,
                hbTimer: null,
                hbWorker: null,
                hbWorkerActive: false,
                heartbeatMs: 15000,
                lastT: 0,
                authed: false,
                lastHeartbeatE: 0,
                reconnectTimer: null,
                shouldReconnect: true,
                latestToken: get(auth.token),
                heartbeatSessionId: null,
                subscriptionsRegistered: false,
                cleanupSubscribers: null
        });

export const wsConnected = wsState.wsConnected;
export const wsConnectionLost = wsState.wsConnectionLost;
export const wsEvent = wsState.wsEvent;
export const wsAuthenticated = wsState.wsAuthenticated;

let socket: WebSocket | null = wsState.socket ?? null;
let hbTimer: ReturnType<typeof setInterval> | null = wsState.hbTimer ?? null;
let hbWorker: Worker | null = wsState.hbWorker ?? null;
let hbWorkerActive = wsState.hbWorkerActive;
let heartbeatMs = wsState.heartbeatMs;
let lastT = wsState.lastT;
let authed = wsState.authed;
let lastHeartbeatE = wsState.lastHeartbeatE; // monotonically increasing heartbeat ack
let reconnectTimer: ReturnType<typeof setTimeout> | null = wsState.reconnectTimer ?? null;
let shouldReconnect = wsState.shouldReconnect;
let latestToken: string | null = wsState.latestToken;
let heartbeatSessionId: string | null = wsState.heartbeatSessionId;

const WS_EVENT_MEMBER_JOIN = 200;
const WS_EVENT_MEMBER_LEAVE = 202;
const WS_EVENT_FRIEND_REQUEST = 402;
const WS_EVENT_FRIEND_REMOVED = 404;
const WS_EVENT_DM_MESSAGE = 405;

const pendingDmUserFetches = new Map<string, Promise<void>>();

function nextT() {
        lastT += 1;
        wsState.lastT = lastT;
        return lastT;
}

function updateLastT(t?: number) {
        if (typeof t === 'number' && t > lastT) {
                lastT = t;
                wsState.lastT = lastT;
        }
}

function wsUrl(): string {
	const runtime = getRuntimeConfig();
	const runtimeConfigured = runtime?.PUBLIC_WS_URL?.trim();
	const configured =
		runtimeConfigured && runtimeConfigured.length > 0
			? runtimeConfigured
			: ((publicEnv?.PUBLIC_WS_URL as string | undefined) || undefined)?.trim();
	if (configured) {
		if (configured.startsWith('ws://') || configured.startsWith('wss://')) return configured;
		if (!browser) return `ws://${configured}`;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${configured}`;
	}
	if (!browser) return 'ws://localhost/ws/subscribe';
	const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const host = window.location.hostname; // omit dev port
	return `${proto}//${host}/ws/subscribe`;
}

function send(obj: AnyRecord) {
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	try {
		socket.send(JSON.stringify(obj));
	} catch {}
}

function sendRaw(raw: string) {
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	try {
		socket.send(raw);
	} catch {}
}

export function sendWSMessage(obj: AnyRecord) {
	send(obj);
}

export function sendWSRaw(raw: string) {
	sendRaw(raw);
}

function normalizeSnowflake(value: unknown): string | null {
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

function updateChannelLastMessageMetadata(
	guildId: string | null,
	channelId: string | null,
	messageId: string | null,
	message: AnyRecord | null
): void {
	if (!guildId || !channelId || !messageId) return;

	channelsByGuild.update((map) => {
		const list = map[guildId];
		if (!Array.isArray(list) || !list.length) return map;

		const idx = list.findIndex(
			(channel) => normalizeSnowflake((channel as AnyRecord)?.id) === channelId
		);
		if (idx === -1) return map;

		const nextChannel: AnyRecord = { ...(list[idx] as AnyRecord) };
		let changed = false;

		const existingLastId = normalizeSnowflake(
			nextChannel.last_message_id ??
				nextChannel.lastMessageId ??
				nextChannel.last_message?.id ??
				nextChannel.lastMessage?.id
		);
		const numericMessageId = Number(messageId);
		const canStoreNumeric = Number.isSafeInteger(numericMessageId);
		const desiredLastMessageId = canStoreNumeric ? numericMessageId : messageId;

		if (existingLastId !== messageId) {
			nextChannel.last_message_id = desiredLastMessageId;
			nextChannel.lastMessageId = messageId;
			changed = true;
		} else {
			if (nextChannel.lastMessageId !== messageId) {
				nextChannel.lastMessageId = messageId;
				changed = true;
			}
			if (nextChannel.last_message_id !== desiredLastMessageId) {
				nextChannel.last_message_id = desiredLastMessageId;
				changed = true;
			}
		}

		if (message && typeof message === 'object') {
			const nextLastMessage = { ...(message as AnyRecord) };
			const previous = nextChannel.last_message;
			const previousId = normalizeSnowflake((previous as AnyRecord | undefined)?.id);
			let shouldUpdateMessage = false;

			if (!previous || typeof previous !== 'object') {
				shouldUpdateMessage = true;
			} else if (previousId !== messageId) {
				shouldUpdateMessage = true;
			} else {
				for (const [key, value] of Object.entries(nextLastMessage)) {
					if ((previous as AnyRecord)[key] !== value) {
						shouldUpdateMessage = true;
						break;
					}
				}
			}

			if (shouldUpdateMessage) {
				nextChannel.last_message = nextLastMessage;
				nextChannel.lastMessage = nextLastMessage;
				changed = true;
			}
		}

		if (!changed) return map;

		const nextList = [...list];
		nextList[idx] = nextChannel;
		return { ...map, [guildId]: nextList };
	});
}

function snapshotGuildIds(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	const ids: string[] = [];
	for (const guild of list) {
		const id = normalizeSnowflake((guild as any)?.id);
		if (id) ids.push(id);
	}
	return ids;
}

function removeMapEntries<T extends Record<string, any>>(map: T, keys: Iterable<string>): T {
	const keySet = new Set<string>();
	for (const key of keys) {
		const normalized = String(key);
		if (normalized) keySet.add(normalized);
	}
	if (!keySet.size) return map;
	let changed = false;
	const copy: Record<string, any> = { ...map };
	for (const key of keySet) {
		if (Object.prototype.hasOwnProperty.call(copy, key)) {
			changed = true;
			delete copy[key];
		}
	}
	return changed ? (copy as T) : map;
}

function pruneGuildCaches(guildIds: string[]) {
	if (!guildIds.length) return;
	const guildIdSet = new Set(guildIds.filter(Boolean));
	if (!guildIdSet.size) return;

	const channelIdsToRemove = new Set<string>();
	const currentChannels = get(channelsByGuild);
	for (const gid of guildIdSet) {
		const list = currentChannels?.[gid];
		if (Array.isArray(list)) {
			for (const channel of list) {
				const cid = normalizeSnowflake((channel as any)?.id);
				if (cid) channelIdsToRemove.add(cid);
			}
		}
	}

	channelsByGuild.update((map) => removeMapEntries(map, guildIdSet));
	membersByGuild.update((map) => removeMapEntries(map, guildIdSet));
	myGuildRoleIdsByGuild.update((map) => removeMapEntries(map, guildIdSet));
	channelRolesByGuild.update((map) => removeMapEntries(map, guildIdSet));
	lastChannelByGuild.update((map) => removeMapEntries(map, guildIdSet));

	if (channelIdsToRemove.size > 0) {
		messagesByChannel.update((map) => removeMapEntries(map, channelIdsToRemove));
	}
}

async function refreshGuildsAfterMembershipChange(prevGuildIds: string[]) {
	const previousSelected = normalizeSnowflake(get(selectedGuildId));
	let nextList: any[] | null = null;
	try {
		nextList = (await auth.loadGuilds()) ?? null;
	} catch {
		nextList = null;
	}
	if (!Array.isArray(nextList)) return;

	const nextIds = new Set(snapshotGuildIds(nextList));
	const removed = prevGuildIds.filter((id) => !nextIds.has(id));
	if (removed.length) {
		pruneGuildCaches(removed);
	}

	if (!previousSelected || !removed.includes(previousSelected)) return;

	const currentSelected = normalizeSnowflake(get(selectedGuildId));
	if (currentSelected && removed.includes(currentSelected)) {
		selectedChannelId.set(null);
		selectedGuildId.set(null);
	}
}

function handleGuildMembershipEvent(data: AnyRecord) {
        if (!data || data.op !== 0) return;
        const eventType = typeof data?.t === 'number' ? data.t : null;
        if (eventType !== WS_EVENT_MEMBER_JOIN && eventType !== WS_EVENT_MEMBER_LEAVE) return;

	const payload = data?.d ?? {};
	const eventUserId =
		normalizeSnowflake(payload?.user_id) ??
		normalizeSnowflake(payload?.member?.user?.id) ??
		normalizeSnowflake(payload?.member?.user_id) ??
		normalizeSnowflake(payload?.member?.id);
	const meId = normalizeSnowflake(get(auth.user)?.id);
	const isSelf = Boolean(meId && eventUserId && meId === eventUserId);

	if (!eventUserId) return;

	const candidateMemberId = (value: any): string | null =>
		normalizeSnowflake(value?.user?.id) ??
		normalizeSnowflake(value?.user_id) ??
		normalizeSnowflake(value?.id);

	const guildId =
		normalizeSnowflake(payload?.guild_id) ??
		normalizeSnowflake(payload?.member?.guild_id) ??
		normalizeSnowflake(payload?.member?.guild?.id) ??
		normalizeSnowflake(payload?.guild?.id);

	if (!guildId) {
		if (isSelf) {
			const prevGuildIds = snapshotGuildIds(get(auth.guilds));
			void refreshGuildsAfterMembershipChange(prevGuildIds);
		}
		return;
	}

	if (eventType === WS_EVENT_MEMBER_JOIN) {
		const member = payload?.member;
		if (member) {
			const cachedMembers = get(membersByGuild)[guildId];
			if (!Array.isArray(cachedMembers)) {
				void ensureGuildMembersLoaded(guildId);
			} else {
				membersByGuild.update((map) => {
					const list = map[guildId];
					if (!Array.isArray(list)) return map;
					const idx = list.findIndex((entry) => {
						const candidateId = candidateMemberId(entry as any);
						return candidateId === eventUserId;
					});
					const nextList =
						idx >= 0 ? [...list.slice(0, idx), member, ...list.slice(idx + 1)] : [...list, member];
					return { ...map, [guildId]: nextList };
				});
			}
		}
	} else if (eventType === WS_EVENT_MEMBER_LEAVE) {
		membersByGuild.update((map) => {
			const list = map[guildId];
			if (!Array.isArray(list)) return map;
			const nextList = list.filter((entry) => {
				const candidateId = candidateMemberId(entry as any);
				return candidateId !== eventUserId;
			});
			if (nextList.length === list.length) return map;
			return { ...map, [guildId]: nextList };
		});
	}

	if (isSelf) {
		const prevGuildIds = snapshotGuildIds(get(auth.guilds));
		void refreshGuildsAfterMembershipChange(prevGuildIds);
	}
}

function collectGuildSubscriptionIds(): string[] {
	const ids = new Set<string>();
	const guildList = get(auth.guilds) as any[] | undefined;
	if (Array.isArray(guildList)) {
		for (const guild of guildList) {
			const gid = normalizeSnowflake(guild?.id) ?? normalizeSnowflake(guild?.guild_id);
			if (gid) ids.add(gid);
		}
	}
	const selected = normalizeSnowflake(get(selectedGuildId));
	if (selected) ids.add(selected);
	return Array.from(ids).filter(Boolean);
}

function resubscribe(channelOverride?: string | null) {
	if (!authed) return;
	const guildIds = collectGuildSubscriptionIds();
	const channelId = channelOverride ?? normalizeSnowflake(get(selectedChannelId));
	subscribeWS(guildIds, channelId ?? undefined);
}

// Preserve large int64 values as strings when parsing WS frames
function parseJSONPreserveLargeInts(data: string) {
	let out = '';
	let i = 0;
	let inStr = false;
	let esc = false;
	while (i < data.length) {
		const ch = data[i];
		if (inStr) {
			out += ch;
			if (esc) esc = false;
			else if (ch === '\\') esc = true;
			else if (ch === '"') inStr = false;
			i++;
			continue;
		}
		if (ch === '"') {
			out += ch;
			inStr = true;
			i++;
			continue;
		}
		if (ch === '-' || (ch >= '0' && ch <= '9')) {
			let p = i - 1;
			while (p >= 0 && /\s/.test(data[p])) p--;
			const prev = p >= 0 ? data[p] : '';
			const okStart = p < 0 || prev === ':' || prev === '[' || prev === '{' || prev === ',';
			if (okStart) {
				const start = i;
				let end = i;
				let hasDot = false,
					hasExp = false;
				if (data[end] === '-') end++;
				while (end < data.length) {
					const c = data[end];
					if (c >= '0' && c <= '9') {
						end++;
						continue;
					}
					if (!hasDot && c === '.') {
						hasDot = true;
						end++;
						continue;
					}
					if (!hasExp && (c === 'e' || c === 'E')) {
						hasExp = true;
						end++;
						if (data[end] === '+' || data[end] === '-') end++;
						while (end < data.length && data[end] >= '0' && data[end] <= '9') end++;
						break;
					}
					break;
				}
				const numLiteral = data.slice(start, end);
				if (!hasDot && !hasExp) {
					const abs = numLiteral[0] === '-' ? numLiteral.slice(1) : numLiteral;
					if (abs.length >= 16) {
						out += '"' + numLiteral + '"';
						i = end;
						continue;
					}
				}
			}
		}
		out += ch;
		i++;
	}
	return JSON.parse(out);
}

function nextHeartbeatE(): number {
        lastHeartbeatE += 1;
        wsState.lastHeartbeatE = lastHeartbeatE;
        return lastHeartbeatE;
}

function sendHeartbeatFrame() {
	const e = nextHeartbeatE();
	const msg = JSON.stringify({
		op: 2,
		d: { e },
		t: 0
	});
	sendRaw(msg);
}

function ensureHeartbeatWorker(): Worker | null {
	if (!browser) return null;
	if (typeof Worker === 'undefined') return null;
        if (!hbWorker) {
                try {
                        hbWorker = new Worker(new URL('./heartbeatWorker.ts', import.meta.url), {
                                type: 'module'
                        });
                        wsState.hbWorker = hbWorker;
                        hbWorker.onmessage = (event: MessageEvent<any>) => {
                                const payload = event?.data;
                                if (!payload || typeof payload !== 'object') return;
                                if (payload.type === 'beat') {
                                        sendHeartbeatFrame();
				} else if (payload.type === 'dispose') {
                                        try {
                                                hbWorker?.terminate();
                                        } catch {}
                                        hbWorker = null;
                                        hbWorkerActive = false;
                                        wsState.hbWorker = null;
                                        wsState.hbWorkerActive = false;
                                }
                        };
                        hbWorker.onerror = () => {
                                try {
                                        hbWorker?.terminate();
                                } catch {}
                                hbWorker = null;
                                hbWorkerActive = false;
                                wsState.hbWorker = null;
                                wsState.hbWorkerActive = false;
                        };
                } catch {
                        hbWorker = null;
                        hbWorkerActive = false;
                        wsState.hbWorker = null;
                        wsState.hbWorkerActive = false;
                        return null;
                }
        }
        return hbWorker;
}

function startHeartbeatWorker(interval: number): boolean {
	const worker = ensureHeartbeatWorker();
	if (!worker) return false;
        try {
                worker.postMessage({ type: 'start', interval });
                hbWorkerActive = true;
                wsState.hbWorkerActive = true;
                return true;
        } catch {
                try {
                        worker.terminate();
                } catch {}
                if (hbWorker === worker) hbWorker = null;
                hbWorkerActive = false;
                if (hbWorker === null) wsState.hbWorker = null;
                wsState.hbWorkerActive = false;
                return false;
        }
}

function buildDmRecipientFromUser(user: AnyRecord | null | undefined, fallbackId: string): AnyRecord {
        const base: AnyRecord = user && typeof user === 'object' ? { ...user } : {};
        if (!base.id) base.id = fallbackId;
        const username =
                (typeof base.username === 'string' && base.username.trim())
                        ? base.username.trim()
                        : (typeof base.name === 'string' && base.name.trim())
                                ? base.name.trim()
                                : null;
        if (!base.username && username) base.username = username;
        if (!base.name && username) base.name = username;
        const displayName =
                (typeof base.display_name === 'string' && base.display_name.trim())
                        ? base.display_name.trim()
                        : (typeof base.global_name === 'string' && base.global_name.trim())
                                ? base.global_name.trim()
                                : username;
        if (!base.display_name && displayName) base.display_name = displayName;
        if (!base.global_name && displayName) base.global_name = displayName;
        const avatarUrl =
                base.avatarUrl ?? base.avatar_url ?? base.avatar ?? base.avatarId ?? base.avatar_id ?? null;
        if (!base.avatarUrl && avatarUrl) base.avatarUrl = avatarUrl;
        if (!base.avatar && avatarUrl) base.avatar = avatarUrl;
        if (!base.avatar_id && avatarUrl) base.avatar_id = avatarUrl;
        if (!base.avatarId && avatarUrl) base.avatarId = avatarUrl;
        return base;
}

function ensureDmChannelUserMetadata(channelId: string, userId: string) {
        const normalizedChannelId = normalizeSnowflake(channelId);
        const normalizedUserId = normalizeSnowflake(userId);
        if (!normalizedChannelId || !normalizedUserId) return;

        const key = `${normalizedChannelId}:${normalizedUserId}`;
        if (pendingDmUserFetches.has(key)) {
                return;
        }

        const promise = (async () => {
                try {
                        const response = await auth.api.user.userUserIdGet({ userId: normalizedUserId });
                        const user = (response?.data as AnyRecord) ?? null;
                        if (!user) return;

                        const candidateName =
                                (typeof user.display_name === 'string' && user.display_name.trim())
                                        ? user.display_name.trim()
                                        : (typeof user.global_name === 'string' && user.global_name.trim())
                                                ? user.global_name.trim()
                                                : (typeof user.username === 'string' && user.username.trim())
                                                        ? user.username.trim()
                                                        : (typeof user.name === 'string' && user.name.trim())
                                                                ? user.name.trim()
                                                                : null;

                        channelsByGuild.update((map) => {
                                const existingList = Array.isArray(map['@me']) ? map['@me'] : [];
                                const idx = existingList.findIndex((entry) => {
                                        const cid = normalizeSnowflake((entry as AnyRecord)?.id);
                                        return cid === normalizedChannelId;
                                });
                                if (idx === -1) return map;

                                const nextChannel: AnyRecord = { ...(existingList[idx] as AnyRecord) };
                                let shouldUpdate = false;

                                const existingUserId =
                                        normalizeSnowflake(nextChannel.user_id) ??
                                        normalizeSnowflake(nextChannel.userId) ??
                                        normalizeSnowflake(nextChannel.recipient_id) ??
                                        normalizeSnowflake(nextChannel.recipientId);
                                if (existingUserId !== normalizedUserId) {
                                        nextChannel.user_id = normalizedUserId;
                                        nextChannel.userId = normalizedUserId;
                                        nextChannel.recipient_id = normalizedUserId;
                                        nextChannel.recipientId = normalizedUserId;
                                        shouldUpdate = true;
                                }

                                const fallbackLabel = `Channel ${normalizedChannelId}`;
                                const existingName = typeof nextChannel.name === 'string' ? nextChannel.name.trim() : '';
                                if (candidateName && (!existingName || existingName === fallbackLabel)) {
                                        nextChannel.name = candidateName;
                                        nextChannel.label = candidateName;
                                        shouldUpdate = true;
                                }

                                const existingTopic = typeof nextChannel.topic === 'string' ? nextChannel.topic.trim() : '';
                                if (candidateName && (!existingTopic || existingTopic === fallbackLabel)) {
                                        nextChannel.topic = candidateName;
                                        shouldUpdate = true;
                                }

                                const recipients = Array.isArray(nextChannel.recipients)
                                        ? [...(nextChannel.recipients as AnyRecord[])]
                                        : [];
                                const hasRecipient = recipients.some((entry) => {
                                        const rid = normalizeSnowflake((entry as AnyRecord)?.id);
                                        return rid === normalizedUserId;
                                });
                                if (!hasRecipient) {
                                        recipients.push(buildDmRecipientFromUser(user, normalizedUserId));
                                        nextChannel.recipients = recipients;
                                        shouldUpdate = true;
                                }

                                if (!shouldUpdate) return map;

                                const nextList = [...existingList];
                                nextList[idx] = nextChannel as DtoChannel;
                                return { ...map, ['@me']: nextList };
                        });
                } catch (error) {
                        console.error('Failed to fetch DM user metadata', error);
                } finally {
                        pendingDmUserFetches.delete(key);
                }
        })();

        pendingDmUserFetches.set(key, promise);
}

function stopHeartbeatWorker() {
        if (!hbWorker || !hbWorkerActive) return;
        try {
                hbWorker.postMessage({ type: 'stop' });
        } catch {}
        hbWorkerActive = false;
        wsState.hbWorkerActive = false;
}

function startHeartbeat() {
        stopHeartbeat();
        if (heartbeatMs <= 0) return;
        const started = startHeartbeatWorker(heartbeatMs);
        if (!started) {
                hbTimer = setInterval(() => {
                        sendHeartbeatFrame();
                }, heartbeatMs);
                wsState.hbTimer = hbTimer;
        }
        // Send an initial heartbeat immediately so the server does not need to wait
        sendHeartbeatFrame();
}

function stopHeartbeat() {
        if (hbTimer) clearInterval(hbTimer);
        hbTimer = null;
        wsState.hbTimer = null;
        stopHeartbeatWorker();
}

export function disconnectWS() {
        shouldReconnect = false;
        wsState.shouldReconnect = false;
        stopHeartbeat();
        if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
                wsState.reconnectTimer = null;
        }
        if (socket) {
                try {
                        socket.close();
                } catch {}
        }
        socket = null;
        wsState.socket = null;
        authed = false;
        wsState.authed = false;
        lastHeartbeatE = 0;
        wsState.lastHeartbeatE = 0;
        wsConnected.set(false);
        wsConnectionLost.set(false);
        wsAuthenticated.set(false);
        heartbeatSessionId = null;
        wsState.heartbeatSessionId = null;
}

export function connectWS() {
        if (!browser) return;
        shouldReconnect = true;
        wsState.shouldReconnect = true;
        if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
                wsState.reconnectTimer = null;
        }
        if (
                socket &&
                (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        )
                return;
        const url = wsUrl();
        socket = new WebSocket(url);
        wsState.socket = socket;
        authed = false;
        wsState.authed = false;
        wsAuthenticated.set(false);

        socket.onopen = () => {
                wsConnected.set(true);
                wsConnectionLost.set(false);
                // Send auth (hello) immediately: op=1 with token and t
                const token = latestToken ?? get(auth.token);
                if (token) {
                        const t = nextT();
                        const tok = JSON.stringify(token);
                        const resumeFragment =
                                heartbeatSessionId && heartbeatSessionId.length
                                        ? `,"heartbeat_session_id":${JSON.stringify(heartbeatSessionId)}`
                                        : '';
                        sendRaw(`{"op":1,"d":{"token":${tok}${resumeFragment}},"t":${t}}`);
                }
        };

	socket.onmessage = (ev) => {
		let data: any;
		try {
			data = typeof ev.data === 'string' ? parseJSONPreserveLargeInts(ev.data) : ev.data;
		} catch {
			return;
		}

		// Handshake: server sends op=1 with d.heartbeat_interval (some servers may send root-level heartbeat_interval)
                if (
                        (data?.op === 1 && typeof data?.d?.heartbeat_interval === 'number') ||
                        typeof data?.heartbeat_interval === 'number'
                ) {
                        const interval = (data?.d?.heartbeat_interval ?? data?.heartbeat_interval) as number;
                        heartbeatMs = interval;
                        wsState.heartbeatMs = heartbeatMs;
                        const sessionId =
                                (data?.d?.session_id ?? data?.session_id ?? null) as string | null;
                        if (typeof sessionId === 'string' && sessionId) {
                                heartbeatSessionId = sessionId;
                                wsState.heartbeatSessionId = heartbeatSessionId;
                        }
                        startHeartbeat();
                        // Mark authed and subscribe to current selections
                        const alreadyAuthed = authed;
                        authed = true;
                        wsState.authed = true;
                        if (!alreadyAuthed) {
                                wsAuthenticated.set(true);
                                // After auth, (re)subscribe to current selections
                                resubscribe();
                        }
                        return;
                }

		updateLastT(data?.t);
		wsEvent.set(data);

		handleGuildMembershipEvent(data);

                if (data?.op === 0 && typeof data?.t === 'number') {
                        if (data.t === 300) {
                                const payload = (data?.d as AnyRecord) ?? {};
                                const message = (payload?.message as AnyRecord) ?? payload;
                                const guildId =
                                        normalizeSnowflake(payload?.guild_id) ??
                                        normalizeSnowflake(message?.guild_id) ??
					normalizeSnowflake(payload?.guild?.id) ??
					normalizeSnowflake(message?.guild?.id);
				const channelId =
					normalizeSnowflake(payload?.channel_id) ??
					normalizeSnowflake(message?.channel_id) ??
					normalizeSnowflake(payload?.channel?.id) ??
					normalizeSnowflake(message?.channel?.id);
				const messageId =
					normalizeSnowflake(payload?.message_id) ??
					normalizeSnowflake(message?.message_id) ??
					normalizeSnowflake(message?.id) ??
					normalizeSnowflake(payload?.id);
				if (guildId && channelId && messageId) {
					let shouldMarkUnread = true;
					if (browser) {
						const focused = Boolean(get(appHasFocus));
						if (focused) {
							const activeGuildId = normalizeSnowflake(get(selectedGuildId));
							const activeChannelId = normalizeSnowflake(get(selectedChannelId));
							if (guildId === activeGuildId && channelId === activeChannelId) {
								shouldMarkUnread = false;
							}
						}
					}

					if (shouldMarkUnread) {
						markChannelUnread(guildId, channelId, messageId);
					}

                                        updateChannelLastMessageMetadata(guildId, channelId, messageId, message);
                                }
                        } else if (data.t === WS_EVENT_FRIEND_REQUEST) {
                                const payload = (data?.d as AnyRecord) ?? {};
                                const requesterId =
                                        normalizeSnowflake(payload?.from?.id) ??
                                        normalizeSnowflake(payload?.user?.id) ??
                                        normalizeSnowflake(payload?.friend?.id) ??
                                        normalizeSnowflake(payload?.relationship?.user_id) ??
                                        normalizeSnowflake(payload?.relationship?.target_id);
                                if (requesterId) {
                                        triggerFriendDataRefresh();
                                }
                        } else if (data.t === WS_EVENT_FRIEND_REMOVED) {
                                const payload = (data?.d as AnyRecord) ?? {};
                                const friendId =
                                        normalizeSnowflake(payload?.friend?.id) ??
                                        normalizeSnowflake(payload?.relationship?.user_id) ??
                                        normalizeSnowflake(payload?.relationship?.target_id) ??
                                        normalizeSnowflake(payload?.from?.id) ??
                                        normalizeSnowflake(payload?.user?.id);
                                if (friendId) {
                                        markFriendRemoved(friendId);
                                        triggerFriendDataRefresh();
                                }
                        } else if (data.t === WS_EVENT_DM_MESSAGE) {
                                const payload = (data?.d as AnyRecord) ?? {};
                                const channelId = normalizeSnowflake(payload?.channel_id);
                                const messageId = normalizeSnowflake(payload?.message_id);
                                if (!channelId || !messageId) {
                                        return;
                                }

                                const senderId = normalizeSnowflake(payload?.from?.id);
                                if (senderId) {
                                        addVisibleDmChannel(channelId, senderId);
                                } else {
                                        addVisibleDmChannel(channelId);
                                }

                                const minimalMessage: AnyRecord = { id: messageId };
                                if (senderId) {
                                        minimalMessage.author_id = senderId;
                                        minimalMessage.authorId = senderId;
                                }

                                let shouldFetchDmMetadata = false;

                                channelsByGuild.update((map) => {
                                        const existingList = Array.isArray(map['@me']) ? map['@me'] : [];
                                        const idx = existingList.findIndex((entry) => {
                                                const id = normalizeSnowflake((entry as AnyRecord)?.id);
                                                return id === channelId;
                                        });
                                        let nextList = existingList;
                                        let shouldUpdate = false;
                                        let target: AnyRecord;
                                        if (idx >= 0) {
                                                target = { ...(existingList[idx] as AnyRecord) };
                                                nextList = [...existingList];
                                        } else {
                                                target = { id: channelId };
                                                nextList = [...existingList, target as DtoChannel];
                                                shouldUpdate = true;
                                        }

                                        if (senderId && target.user_id !== senderId) {
                                                target.user_id = senderId;
                                                target.userId = senderId;
                                                shouldUpdate = true;
                                        }

                                        if (target.last_message_id !== messageId) {
                                                target.last_message_id = messageId;
                                                shouldUpdate = true;
                                        }
                                        if (target.lastMessageId !== messageId) {
                                                target.lastMessageId = messageId;
                                                shouldUpdate = true;
                                        }

                                        if (minimalMessage) {
                                                target.last_message = minimalMessage;
                                                target.lastMessage = minimalMessage;
                                                shouldUpdate = true;
                                        }

                                        if (!shouldUpdate && idx >= 0) {
                                                return map;
                                        }

                                        if (senderId && !isFriendId(senderId)) {
                                                const fallbackLabel = `Channel ${channelId}`;
                                                const existingLabel = (() => {
                                                        if (typeof target.name === 'string') return target.name.trim();
                                                        if (typeof target.label === 'string') return target.label.trim();
                                                        return '';
                                                })();
                                                const recipients = Array.isArray(target.recipients)
                                                        ? (target.recipients as AnyRecord[])
                                                        : [];
                                                const hasRecipient = recipients.some((entry) => {
                                                        const rid = normalizeSnowflake((entry as AnyRecord)?.id);
                                                        return rid === senderId;
                                                });
                                                if (!hasRecipient || !existingLabel || existingLabel === fallbackLabel) {
                                                        shouldFetchDmMetadata = true;
                                                }
                                        }

                                        if (idx >= 0) {
                                                nextList[idx] = target as DtoChannel;
                                        } else {
                                                nextList[nextList.length - 1] = target as DtoChannel;
                                        }

                                        return { ...map, ['@me']: nextList };
                                });

                                const activeGuildId = normalizeSnowflake(get(selectedGuildId));
                                const activeChannelId = normalizeSnowflake(get(selectedChannelId));
                                const isActiveDm = activeGuildId === '@me' && activeChannelId === channelId;
                                if (!isActiveDm) {
                                        markChannelUnread('@me', channelId, messageId);
                                }

                                if (shouldFetchDmMetadata && senderId) {
                                        ensureDmChannelUserMetadata(channelId, senderId);
                                }
                        }

                        if (data?.d?.message) {
                                // nothing here; consumers react via wsEvent
                        }
                }
	};

        socket.onclose = () => {
                wsConnected.set(false);
                wsAuthenticated.set(false);
                stopHeartbeat();
                authed = false;
                wsState.authed = false;
                socket = null;
                wsState.socket = null;
                if (!shouldReconnect) return;
                wsConnectionLost.set(true);
                if (!reconnectTimer) {
                        reconnectTimer = setTimeout(() => {
                                reconnectTimer = null;
                                wsState.reconnectTimer = null;
                                connectWS();
                        }, 1000);
                        wsState.reconnectTimer = reconnectTimer;
                }
        };

	socket.onerror = () => {
		// handled by onclose
	};
}

export function subscribeWS(guilds: (number | string)[] = [], channel?: number | string) {
	// Require that handshake and auth likely succeeded
	if (!authed) return;
	// IDs must be sent as raw int64 literals in JSON to avoid precision loss
	const ids = (guilds || []).map((g) => String(g).replace(/[^0-9]/g, '')).filter(Boolean);
	const ch = channel != null ? String(channel).replace(/[^0-9]/g, '') : '';
	const t = nextT();
	const dGuilds = `[${ids.join(',')}]`;
	const dChannel = ch ? `,"channel":${ch}` : '';
	const raw = `{"op":5,"d":{"guilds":${dGuilds}${dChannel}},"t":${t}}`;
	sendRaw(raw);
}

// React to auth & selection changes (browser only)
if (browser && !wsState.subscriptionsRegistered) {
        const unsubscribers: (() => void)[] = [];

        unsubscribers.push(
                auth.token.subscribe((value) => {
                        latestToken = value;
                        wsState.latestToken = value;
                })
        );

        unsubscribers.push(
                auth.isAuthenticated.subscribe((ok) => {
                        if (ok) connectWS();
                        else disconnectWS();
                })
        );

        unsubscribers.push(
                selectedChannelId.subscribe((ch) => {
                        const channelId = normalizeSnowflake(ch);
                        resubscribe(channelId);
                })
        );

        unsubscribers.push(
                selectedGuildId.subscribe(() => {
                        resubscribe();
                })
        );

        unsubscribers.push(
                auth.guilds.subscribe(() => {
                        resubscribe();
                })
        );

        wsState.cleanupSubscribers = () => {
                for (const unsubscribe of unsubscribers.splice(0, unsubscribers.length)) {
                        try {
                                unsubscribe();
                        } catch {}
                }
                wsState.subscriptionsRegistered = false;
                wsState.cleanupSubscribers = null;
        };

        wsState.subscriptionsRegistered = true;

        if (import.meta.hot) {
                import.meta.hot.dispose(() => {
                        wsState.cleanupSubscribers?.();
                        disconnectWS();
                        if (hbWorker) {
                                try {
                                        hbWorker.terminate();
                                } catch {}
                        }
                        hbWorker = null;
                        wsState.hbWorker = null;
                        hbWorkerActive = false;
                        wsState.hbWorkerActive = false;
                });
        }
}
