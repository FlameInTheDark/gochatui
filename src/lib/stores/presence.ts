import { browser } from '$app/environment';
import { get, writable, type Readable } from 'svelte/store';
import { auth } from './auth';
import { appHasFocus } from './appState';
import { sendWSMessage, sendWSRaw, wsAuthenticated, wsEvent } from '$lib/client/ws';

type AnyRecord = Record<string, unknown>;

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type PresenceMode = 'auto' | 'idle' | 'dnd' | 'offline';

export interface PresenceInfo {
	status: PresenceStatus;
	since: number | null;
}

const AUTO_IDLE_MS = 120_000;
const ACTIVITY_THROTTLE_MS = 1_500;

const presenceStore = writable<Record<string, PresenceInfo>>({});
export const presenceByUser: Readable<Record<string, PresenceInfo>> = {
	subscribe: presenceStore.subscribe
};

const selfStatusStore = writable<PresenceStatus>('online');
export const selfPresenceStatus: Readable<PresenceStatus> = {
	subscribe: selfStatusStore.subscribe
};

const selfModeStore = writable<PresenceMode>('auto');
export const selfPresenceMode: Readable<PresenceMode> = {
	subscribe: selfModeStore.subscribe
};

const presenceClassMap: Record<PresenceStatus, string> = {
	online: 'bg-emerald-500',
	idle: 'bg-amber-400',
	dnd: 'bg-rose-500',
	offline: 'bg-zinc-500'
};

export function presenceIndicatorClass(status: PresenceStatus | null | undefined): string {
	return presenceClassMap[status ?? 'offline'];
}

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

function normalizeStatus(value: unknown): PresenceStatus | null {
	if (typeof value !== 'string') return null;
	switch (value.toLowerCase()) {
		case 'online':
			return 'online';
		case 'idle':
			return 'idle';
		case 'dnd':
		case 'do_not_disturb':
			return 'dnd';
		case 'offline':
		case 'invisible':
			return 'offline';
		default:
			return null;
	}
}

function parseSince(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

let currentMode: PresenceMode = 'auto';
let manualOverride: Exclude<PresenceMode, 'auto'> | null = null;
let desiredStatus: PresenceStatus = 'online';
let currentStatus: PresenceStatus = 'online';
let lastSentStatus: PresenceStatus | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityAt = browser ? Date.now() : 0;
let lastDomActivityAt = 0;
let currentUserId: string | null = null;

const presenceSources = new Map<symbol, Set<string>>();
let combinedTrackedUserIds = new Set<string>();
let desiredSubscriptionIds: string[] = [];
let desiredSubscriptionSignature = '';
let lastSentSubscriptionSignature = '';
let subscriptionFlushScheduled = false;

function scheduleSubscriptionRecompute() {
	if (subscriptionFlushScheduled) return;
	subscriptionFlushScheduled = true;
	queueMicrotask(() => {
		subscriptionFlushScheduled = false;
		recomputeTrackedUserIds();
	});
}

function recomputeTrackedUserIds() {
	const union = new Set<string>();
	for (const ids of presenceSources.values()) {
		for (const id of ids) {
			if (id) union.add(id);
		}
	}

	let changed = union.size !== combinedTrackedUserIds.size;
	if (!changed) {
		for (const id of union) {
			if (!combinedTrackedUserIds.has(id)) {
				changed = true;
				break;
			}
		}
	}
	if (!changed) {
		for (const id of combinedTrackedUserIds) {
			if (!union.has(id)) {
				changed = true;
				break;
			}
		}
	}

	combinedTrackedUserIds = union;

	const normalized: string[] = [];
	for (const id of union) {
		const digits = id.replace(/[^0-9]/g, '');
		if (digits) normalized.push(digits);
	}
	normalized.sort((a, b) => {
		if (a.length !== b.length) return a.length - b.length;
		return a < b ? -1 : a > b ? 1 : 0;
	});

	desiredSubscriptionIds = normalized;
	desiredSubscriptionSignature = normalized.join(',');

	prunePresence(union);
	flushPresenceSubscription(false);
}

function prunePresence(active: Set<string>) {
	const allowed = new Set(active);
	if (currentUserId) allowed.add(currentUserId);
	presenceStore.update((map) => {
		let changed = false;
		const next: Record<string, PresenceInfo> = { ...map };
		for (const key of Object.keys(next)) {
			if (!allowed.has(key)) {
				delete next[key];
				changed = true;
			}
		}
		return changed ? next : map;
	});
}

function flushPresenceSubscription(force: boolean) {
	if (!browser) return;
	const ready = get(wsAuthenticated);
	if (!ready) return;
	if (!force && desiredSubscriptionSignature === lastSentSubscriptionSignature) return;
	const payload = desiredSubscriptionIds.length
		? `{"op":6,"d":{"set":[${desiredSubscriptionIds.join(',')}]}}`
		: '{"op":6,"d":{"clear":true}}';
	sendWSRaw(payload);
	lastSentSubscriptionSignature = desiredSubscriptionSignature;
}

export function createPresenceSubscription() {
	const key = Symbol('presence-subscription');
	presenceSources.set(key, new Set());
	scheduleSubscriptionRecompute();
	return {
		update(userIds: Iterable<unknown>) {
			const normalized = new Set<string>();
			for (const value of userIds ?? []) {
				const id = toSnowflakeString(value);
				if (id) normalized.add(id);
			}
			presenceSources.set(key, normalized);
			scheduleSubscriptionRecompute();
		},
		destroy() {
			presenceSources.delete(key);
			scheduleSubscriptionRecompute();
		}
	};
}

function transmitSelfPresence(status: PresenceStatus, forceSend: boolean) {
	selfStatusStore.set(status);
	currentStatus = status;
	if (currentUserId) {
		presenceStore.update((map) => {
			const prev = map[currentUserId!];
			if (prev?.status === status && prev?.since == null) return map;
			return {
				...map,
				[currentUserId!]: { status, since: null }
			};
		});
	}
	if (!browser) return;
	const ready = get(wsAuthenticated);
	if (!ready) {
		if (forceSend) lastSentStatus = null;
		return;
	}
	if (!forceSend && lastSentStatus === status) return;
	sendWSMessage({ op: 3, d: { status } });
	lastSentStatus = status;
}

function setSelfPresence(status: PresenceStatus) {
	desiredStatus = status;
	transmitSelfPresence(status, false);
}

function syncSelfPresence(force: boolean) {
	transmitSelfPresence(desiredStatus, force);
}

function clearIdleTimer() {
	if (idleTimer) {
		clearTimeout(idleTimer);
		idleTimer = null;
	}
}

function scheduleIdleTimer() {
	if (!browser) return;
	if (currentMode !== 'auto') return;
	clearIdleTimer();
	const elapsed = Date.now() - lastActivityAt;
	const delay = Math.max(0, AUTO_IDLE_MS - elapsed);
	idleTimer = setTimeout(() => {
		idleTimer = null;
		if (currentMode !== 'auto') return;
		const since = Date.now() - lastActivityAt;
		if (since >= AUTO_IDLE_MS) {
			setSelfPresence('idle');
		} else {
			scheduleIdleTimer();
		}
	}, delay);
}

function recordActivity(force: boolean) {
        if (currentMode !== 'auto') return;
        if (manualOverride) return;
        const now = Date.now();
        if (!force && now - lastDomActivityAt < ACTIVITY_THROTTLE_MS) return;
	lastDomActivityAt = now;
	lastActivityAt = now;
	if (currentStatus !== 'online') {
		setSelfPresence('online');
	} else {
		desiredStatus = 'online';
		transmitSelfPresence('online', false);
	}
	scheduleIdleTimer();
}

export function setSelfPresenceMode(mode: PresenceMode) {
        currentMode = mode;
        selfModeStore.set(mode);
        if (mode === 'auto') {
                manualOverride = null;
                lastActivityAt = Date.now();
                recordActivity(true);
        } else {
                manualOverride = mode;
                clearIdleTimer();
                setSelfPresence(mode);
        }
}

function applyPresencePayload(payload: AnyRecord | null | undefined) {
	if (!payload) return;
	const userId =
		toSnowflakeString((payload as AnyRecord)?.user_id) ??
		toSnowflakeString((payload as AnyRecord)?.userId);
	if (!userId) return;
	const status = normalizeStatus((payload as AnyRecord)?.status);
	if (!status) return;
	const since = parseSince((payload as AnyRecord)?.since);
	presenceStore.update((map) => {
		const prev = map[userId];
		if (prev?.status === status && prev?.since === since) return map;
		return {
			...map,
			[userId]: { status, since }
		};
	});
	if (userId === currentUserId) {
		currentStatus = status;
		selfStatusStore.set(status);
		if (currentMode === 'auto') {
			if (status === 'online') {
				recordActivity(true);
			}
		}
	}
}

if (browser) {
	setSelfPresenceMode('auto');
	scheduleIdleTimer();

	const activityHandler = () => recordActivity(false);
	window.addEventListener('pointerdown', activityHandler, { passive: true });
	window.addEventListener('pointermove', activityHandler, { passive: true });
	window.addEventListener('keydown', activityHandler, { passive: true });
	window.addEventListener('touchstart', activityHandler, { passive: true });
	window.addEventListener('focus', () => recordActivity(true));
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			recordActivity(true);
		}
	});

	appHasFocus.subscribe((focused) => {
		if (focused) recordActivity(true);
	});

	wsEvent.subscribe((event) => {
		if (!event) return;
		if (event.op === 3) {
			applyPresencePayload((event as AnyRecord).d as AnyRecord);
		}
	});

	wsAuthenticated.subscribe((ready) => {
		if (ready) {
			lastSentSubscriptionSignature = '';
			lastSentStatus = null;
			flushPresenceSubscription(true);
			syncSelfPresence(true);
		} else {
			lastSentSubscriptionSignature = '';
			lastSentStatus = null;
		}
	});
}

auth.user.subscribe((user) => {
	const nextId = toSnowflakeString(user?.id);
	const prevId = currentUserId;
	currentUserId = nextId;
	if (!nextId) {
		presenceStore.set({});
		return;
	}
	presenceStore.update((map) => {
		const next = { ...map };
		if (prevId && prevId !== nextId) {
			delete next[prevId];
		}
		const existing = next[nextId];
		if (!existing || existing.status !== currentStatus) {
			next[nextId] = { status: currentStatus, since: null };
		}
		return next;
	});
});

auth.isAuthenticated.subscribe((ok) => {
        if (!ok) {
                presenceSources.clear();
                combinedTrackedUserIds = new Set();
                desiredSubscriptionIds = [];
                desiredSubscriptionSignature = '';
                lastSentSubscriptionSignature = '';
                presenceStore.set({});
                currentUserId = null;
                currentMode = 'auto';
                manualOverride = null;
                desiredStatus = 'online';
                currentStatus = 'online';
                lastSentStatus = null;
                clearIdleTimer();
        }
});
