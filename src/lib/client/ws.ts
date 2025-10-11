import { writable, get } from 'svelte/store';
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

type AnyRecord = Record<string, any>;

export const wsConnected = writable(false);
export const wsConnectionLost = writable(false);
export const wsEvent = writable<AnyRecord | null>(null);
export const wsAuthenticated = writable(false);

let socket: WebSocket | null = null;
let hbTimer: any = null;
let heartbeatMs = 15000;
let lastT = 0;
let authed = false;
let lastEventId = 0; // track last received/sent event id
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = true;
let latestToken: string | null = get(auth.token);

const WS_EVENT_MEMBER_JOIN = 200;
const WS_EVENT_MEMBER_LEAVE = 202;

function nextT() {
	lastT += 1;
	return lastT;
}

function updateLastT(t?: number) {
	if (typeof t === 'number' && t > lastT) lastT = t;
	if (typeof t === 'number' && t > lastEventId) lastEventId = t;
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

function startHeartbeat() {
	stopHeartbeat();
	if (heartbeatMs > 0) {
		hbTimer = setInterval(() => {
			// Heartbeat op=2 with last event id in data.e
			const t = nextT();
			const e = lastEventId || lastT || 0;
			const msg = `{"op":2,"data":{"e":${e}},"t":${t}}`;
			sendRaw(msg);
		}, heartbeatMs);
	}
}

function stopHeartbeat() {
	if (hbTimer) clearInterval(hbTimer);
	hbTimer = null;
}

export function disconnectWS() {
	shouldReconnect = false;
	stopHeartbeat();
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (socket) {
		try {
			socket.close();
		} catch {}
	}
	socket = null;
	authed = false;
	wsConnected.set(false);
	wsConnectionLost.set(false);
	wsAuthenticated.set(false);
}

export function connectWS() {
	if (!browser) return;
	shouldReconnect = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (
		socket &&
		(socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
	)
		return;
	const url = wsUrl();
	socket = new WebSocket(url);
	authed = false;
	wsAuthenticated.set(false);

	socket.onopen = () => {
		wsConnected.set(true);
		wsConnectionLost.set(false);
		// Send auth (hello) immediately: op=1 with token and t
		const token = latestToken ?? get(auth.token);
		if (token) {
			const t = nextT();
			const tok = JSON.stringify(token);
			sendRaw(`{"op":1,"d":{"token":${tok}},"t":${t}}`);
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
			startHeartbeat();
			// Mark authed and subscribe to current selections
			authed = true;
			wsAuthenticated.set(true);
			// After auth, (re)subscribe to current selections
			resubscribe();
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
		socket = null;
		if (!shouldReconnect) return;
		wsConnectionLost.set(true);
		if (!reconnectTimer) {
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connectWS();
			}, 1000);
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
if (browser) {
	auth.token.subscribe((value) => {
		latestToken = value;
	});

	auth.isAuthenticated.subscribe((ok) => {
		if (ok) connectWS();
		else disconnectWS();
	});

	selectedChannelId.subscribe((ch) => {
		const channelId = normalizeSnowflake(ch);
		resubscribe(channelId);
	});

	selectedGuildId.subscribe(() => {
		resubscribe();
	});

	auth.guilds.subscribe(() => {
		resubscribe();
	});
}
