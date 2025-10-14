import { get, writable, type Readable } from 'svelte/store';
import { auth } from './auth';
import { toSnowflakeString } from '$lib/utils/members';

type AnyRecord = Record<string, unknown>;

const friendIdsStore = writable<Set<string>>(new Set());
const loadingStore = writable(false);

let lastLoadedAt: number | null = null;
let pendingRefresh: Promise<Set<string>> | null = null;

function cloneSet(source: Set<string>): Set<string> {
	return new Set(source);
}

function extractCandidateId(candidate: unknown): string | null {
	if (candidate == null) return null;
	if (typeof candidate !== 'object') {
		return toSnowflakeString(candidate);
	}

	const record = candidate as AnyRecord;
	const direct =
		toSnowflakeString(record.id) ??
		toSnowflakeString(record.user_id) ??
		toSnowflakeString(record.userId) ??
		toSnowflakeString((record.user as AnyRecord | undefined)?.id) ??
		toSnowflakeString((record.friend as AnyRecord | undefined)?.id) ??
		toSnowflakeString((record.friend as AnyRecord | undefined)?.user_id) ??
		toSnowflakeString((record.relationship as AnyRecord | undefined)?.user_id) ??
		toSnowflakeString((record.relationship as AnyRecord | undefined)?.userId) ??
		toSnowflakeString((record.relationship as AnyRecord | undefined)?.target_id) ??
		toSnowflakeString((record.member as AnyRecord | undefined)?.user_id) ??
		toSnowflakeString((record.member as AnyRecord | undefined)?.userId) ??
		toSnowflakeString((record.member as AnyRecord | undefined)?.user?.id);

	if (direct) {
		return direct;
	}

	const nestedCandidates = [
		record.user,
		record.friend,
		record.relationship,
		(record.relationship as AnyRecord | undefined)?.user,
		record.target,
		record.target_user,
		record.targetUser,
		record.recipient,
		record.sender,
		record.initiator,
		record.profile,
		(record.profile as AnyRecord | undefined)?.user,
		record.data,
		record.value
	];

	for (const nested of nestedCandidates) {
		const resolved = extractCandidateId(nested);
		if (resolved) {
			return resolved;
		}
	}

	return null;
}

function normalizeFriendList(list: unknown): Set<string> {
	const ids = new Set<string>();
	if (!Array.isArray(list)) {
		return ids;
	}
	for (const entry of list) {
		const id = extractCandidateId(entry);
		if (id) {
			ids.add(id);
		}
	}
	return ids;
}

function setFriendIds(ids: Iterable<string>): void {
	friendIdsStore.set(new Set(ids));
}

async function fetchFriends(): Promise<Set<string>> {
	if (!get(auth.isAuthenticated)) {
		setFriendIds([]);
		lastLoadedAt = null;
		return new Set();
	}
	loadingStore.set(true);
	try {
		const res = await auth.api.user.userMeFriendsGet();
		const ids = applyFriendList(res.data ?? []);
		return ids;
	} finally {
		loadingStore.set(false);
	}
}

export const friendIds: Readable<Set<string>> = {
	subscribe(run) {
		return friendIdsStore.subscribe((set) => {
			run(cloneSet(set));
		});
	}
};

export const friendsLoading: Readable<boolean> = {
	subscribe: loadingStore.subscribe
};

export function applyFriendList(list: unknown): Set<string> {
	const ids = normalizeFriendList(list);
	setFriendIds(ids);
	lastLoadedAt = Date.now();
	return ids;
}

export function markFriendAdded(id: string | null | undefined): void {
	const normalized = toSnowflakeString(id);
	if (!normalized) return;
	friendIdsStore.update((set) => {
		if (set.has(normalized)) return set;
		const next = new Set(set);
		next.add(normalized);
		lastLoadedAt = Date.now();
		return next;
	});
}

export function markFriendRemoved(id: string | null | undefined): void {
	const normalized = toSnowflakeString(id);
	if (!normalized) return;
	friendIdsStore.update((set) => {
		if (!set.has(normalized)) return set;
		const next = new Set(set);
		next.delete(normalized);
		lastLoadedAt = Date.now();
		return next;
	});
}

export function refreshFriends(force = false): Promise<Set<string>> {
	if (!force && lastLoadedAt != null) {
		return Promise.resolve(cloneSet(get(friendIdsStore)));
	}
	if (!pendingRefresh) {
		pendingRefresh = fetchFriends()
			.then((result) => {
				pendingRefresh = null;
				return result;
			})
			.catch((error) => {
				pendingRefresh = null;
				throw error;
			});
	}
	return pendingRefresh;
}

export function ensureFriendsLoaded(): Promise<Set<string>> {
	if (lastLoadedAt != null) {
		return Promise.resolve(cloneSet(get(friendIdsStore)));
	}
	return refreshFriends(true);
}

auth.user.subscribe((value) => {
	if (!value) {
		setFriendIds([]);
		lastLoadedAt = null;
	}
});
