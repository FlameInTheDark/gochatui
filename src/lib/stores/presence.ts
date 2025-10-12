import { browser } from '$app/environment';
import { get, writable, type Readable } from 'svelte/store';
import { auth } from './auth';
import { appHasFocus } from './appState';
import { appSettings, mutateAppSettings, settingsReady } from './settings';
import type { AppSettings } from './settings';
import { sendWSMessage, sendWSRaw, wsAuthenticated, wsEvent } from '$lib/client/ws';
import type { PresenceMode, PresenceStatus } from '$lib/types/presence';

type AnyRecord = Record<string, unknown>;

export type { PresenceMode, PresenceStatus } from '$lib/types/presence';

export interface PresenceInfo {
        status: PresenceStatus;
        since: number | null;
        customStatusText: string | null;
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

const selfCustomStatusStore = writable<string | null>(null);
export const selfCustomStatusText: Readable<string | null> = {
        subscribe: selfCustomStatusStore.subscribe
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

function normalizeCustomStatusText(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        return trimmed.slice(0, 256);
}

function parseSince(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
                const parsed = Number.parseInt(value, 10);
                if (Number.isFinite(parsed)) return parsed;
        }
        return null;
}

function extractCustomStatusPayload(payload: AnyRecord | null | undefined): {
        found: boolean;
        value: unknown;
} {
        if (!payload || typeof payload !== 'object') {
                return { found: false, value: null };
        }
        if ('custom_status_text' in payload) {
                return { found: true, value: (payload as AnyRecord).custom_status_text };
        }
        if ('customStatusText' in payload) {
                return { found: true, value: (payload as AnyRecord).customStatusText };
        }
        const nested = (payload as AnyRecord).status;
        if (nested && typeof nested === 'object') {
                if ('custom_status_text' in (nested as AnyRecord)) {
                        return { found: true, value: (nested as AnyRecord).custom_status_text };
                }
                if ('customStatusText' in (nested as AnyRecord)) {
                        return { found: true, value: (nested as AnyRecord).customStatusText };
                }
        }
        return { found: false, value: null };
}

let currentMode: PresenceMode = 'auto';
let manualOverride: Exclude<PresenceMode, 'auto'> | null = null;
let desiredStatus: PresenceStatus = 'online';
let currentStatus: PresenceStatus = 'online';
let currentCustomStatusText: string | null = null;
let lastSentPresence: { status: PresenceStatus; customStatusText: string | null } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityAt = browser ? Date.now() : 0;
let lastDomActivityAt = 0;
let currentUserId: string | null = null;

let settingsReadyFlag = false;
let lastSettingsMode: PresenceMode | null = null;
let lastSettingsStatus: PresenceStatus | null = null;
let lastSettingsCustomStatus: string | null = null;

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

function updateSelfCustomStatus(text: string | null) {
        const normalized = text ?? null;
        if (currentCustomStatusText === normalized) {
                selfCustomStatusStore.set(normalized);
                return;
        }
        currentCustomStatusText = normalized;
        selfCustomStatusStore.set(normalized);
        if (!currentUserId) return;
        presenceStore.update((map) => {
                const prev = map[currentUserId!];
                if (prev?.customStatusText === normalized) return map;
                const next: PresenceInfo = {
                        status: prev?.status ?? currentStatus,
                        since: prev?.since ?? null,
                        customStatusText: normalized
                };
                return { ...map, [currentUserId!]: next };
        });
}

function transmitSelfPresence(status: PresenceStatus, forceSend: boolean) {
        selfStatusStore.set(status);
        currentStatus = status;
        if (currentUserId) {
                presenceStore.update((map) => {
                        const prev = map[currentUserId!];
                        if (
                                prev?.status === status &&
                                prev?.since == null &&
                                prev?.customStatusText === currentCustomStatusText
                        )
                                return map;
                        return {
                                ...map,
                                [currentUserId!]: {
                                        status,
                                        since: null,
                                        customStatusText: currentCustomStatusText
                                }
                        };
                });
        }
        if (!browser) return;
        const ready = get(wsAuthenticated);
        if (!ready) {
                if (forceSend) lastSentPresence = null;
                return;
        }
        const customStatusText = currentCustomStatusText ?? null;
        if (
                !forceSend &&
                lastSentPresence &&
                lastSentPresence.status === status &&
                lastSentPresence.customStatusText === customStatusText
        ) {
                return;
        }
        sendWSMessage({ op: 3, d: { status, custom_status_text: customStatusText } });
        lastSentPresence = { status, customStatusText };
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
        applyModeFromUser(mode);
        const nextStatus: PresenceStatus = mode === 'auto' ? 'online' : (mode as Exclude<PresenceMode, 'auto'>);
        mutateAppSettings((settings) => {
                let changed = false;
                if (settings.presenceMode !== mode) {
                        settings.presenceMode = mode;
                        changed = true;
                }
                if (settings.status.status !== nextStatus) {
                        settings.status.status = nextStatus;
                        changed = true;
                }
                return changed;
        });
}

export function setSelfCustomStatusText(value: string | null) {
        const normalized = normalizeCustomStatusText(value);
        updateSelfCustomStatus(normalized);
        mutateAppSettings((settings) => {
                if (settings.status.customStatusText === normalized) return false;
                settings.status.customStatusText = normalized;
                return true;
        });
        transmitSelfPresence(currentStatus, false);
}

function applyModeFromUser(mode: PresenceMode) {
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
        let nextCustomStatusText: string | null = null;
        const customStatusPayload = extractCustomStatusPayload(payload);
        presenceStore.update((map) => {
                const prev = map[userId];
                const customStatusText = customStatusPayload.found
                        ? normalizeCustomStatusText(customStatusPayload.value)
                        : prev?.customStatusText ?? null;
                nextCustomStatusText = customStatusText;
                if (
                        prev?.status === status &&
                        prev?.since === since &&
                        prev?.customStatusText === customStatusText
                )
                        return map;
                return {
                        ...map,
                        [userId]: { status, since, customStatusText }
                };
        });
        if (userId === currentUserId) {
                currentStatus = status;
                selfStatusStore.set(status);
                if (nextCustomStatusText !== currentCustomStatusText) {
                        currentCustomStatusText = nextCustomStatusText;
                        selfCustomStatusStore.set(nextCustomStatusText);
                } else {
                        selfCustomStatusStore.set(nextCustomStatusText);
                }
                if (currentMode === 'auto') {
                        if (status === 'online') {
                                recordActivity(true);
                        }
                }
	}
}

function applyPresenceFromSettings(
        mode: PresenceMode,
        status: PresenceStatus,
        customStatusText: string | null
) {
        updateSelfCustomStatus(customStatusText);
        currentMode = mode;
        selfModeStore.set(mode);
        if (mode === 'auto') {
                manualOverride = null;
                desiredStatus = status;
                transmitSelfPresence(status, false);
                if (browser) {
                        const now = Date.now();
                        lastActivityAt = status === 'idle' ? now - AUTO_IDLE_MS : now;
                        scheduleIdleTimer();
                }
        } else {
                manualOverride = mode;
                clearIdleTimer();
                desiredStatus = status;
                transmitSelfPresence(status, false);
        }
}

function applySettingsSnapshot(settings: AppSettings) {
        const mode = settings.presenceMode ?? 'auto';
        const status = settings.status?.status ?? 'online';
        const custom = settings.status?.customStatusText ?? null;
        if (
                mode === lastSettingsMode &&
                status === lastSettingsStatus &&
                (custom ?? null) === (lastSettingsCustomStatus ?? null)
        ) {
                return;
        }
        lastSettingsMode = mode;
        lastSettingsStatus = status;
        lastSettingsCustomStatus = custom ?? null;
        applyPresenceFromSettings(mode, status, custom ?? null);
}

settingsReady.subscribe((ready) => {
        settingsReadyFlag = ready;
        if (!ready) {
                lastSettingsMode = null;
                lastSettingsStatus = null;
                lastSettingsCustomStatus = null;
                return;
        }
        applySettingsSnapshot(get(appSettings));
});

appSettings.subscribe((settings) => {
        if (!settingsReadyFlag) return;
        applySettingsSnapshot(settings);
});

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
                        lastSentPresence = null;
                        flushPresenceSubscription(true);
                        syncSelfPresence(true);
                } else {
                        lastSentSubscriptionSignature = '';
                        lastSentPresence = null;
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
                if (
                        !existing ||
                        existing.status !== currentStatus ||
                        existing.customStatusText !== currentCustomStatusText
                ) {
                        next[nextId] = {
                                status: currentStatus,
                                since: null,
                                customStatusText: currentCustomStatusText
                        };
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
                currentCustomStatusText = null;
                selfCustomStatusStore.set(null);
                lastSentPresence = null;
                clearIdleTimer();
        }
});
