import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';
import type {
        AuthLoginRequest,
        AuthRegisterRequest,
        AuthConfirmationRequest,
        AuthPasswordRecoveryRequest,
        AuthPasswordResetRequest,
        DtoUser,
        DtoGuild
} from '$lib/api';
import { createApi } from '$lib/client/api';
import { normalizePermissionValue } from '$lib/utils/permissions';

const TOKEN_KEY = 'gochat.token';
const REFRESH_KEY = 'gochat.refresh';
const USER_KEY = 'gochat.user';

const REFRESH_LEEWAY_MS = 30_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function decodeTokenExpiry(token: string): number | null {
        try {
                const part = token.split('.')[1] || '';
                const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
                const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
                const json =
                        typeof atob === 'function'
                                ? atob(padded)
                                : Buffer.from(padded, 'base64').toString('utf8');
                const payload = JSON.parse(json) as { exp?: number };
                return typeof payload.exp === 'number' ? payload.exp : null;
        } catch {
                return null;
        }
}

function computeRefreshLeadTime(token: string): number | null {
        const exp = decodeTokenExpiry(token);
        if (!exp) return null;
        const expiresAt = exp * 1000;
        const msUntilExpiry = expiresAt - Date.now();
        if (!Number.isFinite(msUntilExpiry)) return null;
        if (msUntilExpiry <= 0) return 0;
        const delay = Math.max(0, msUntilExpiry - REFRESH_LEEWAY_MS);
        return Math.min(delay, MAX_TIMEOUT_MS);
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

function normalizeRefreshToken(value: string | null | undefined): string | null {
        if (!value) return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const bearerMatch = trimmed.match(/^bearer\s+/i);
        if (bearerMatch) {
                const token = trimmed.slice(bearerMatch[0].length).trim();
                return token ? `Bearer ${token}` : null;
        }
        return `Bearer ${trimmed}`;
}

function createAuthStore() {
        const token = writable<string | null>(
                typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
        );
        const refreshToken = writable<string | null>(
                typeof localStorage !== 'undefined'
                        ? normalizeRefreshToken(localStorage.getItem(REFRESH_KEY))
                        : null
        );

	let refreshTimer: ReturnType<typeof setTimeout> | null = null;

	function clearRefreshTimer() {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	}

	// Separate API instance for token refresh without automatic auth header
	const refreshApi = createApi(() => null);

	function scheduleTokenRefresh(currentToken: string | null) {
		clearRefreshTimer();
		if (!browser) return;
		if (!currentToken) return;
		const rt = get(refreshToken);
		if (!rt) return;
		const delay = computeRefreshLeadTime(currentToken);
		if (delay == null) return;
		refreshTimer = setTimeout(async () => {
			refreshTimer = null;
			await refresh();
		}, delay);
	}

	async function refresh(): Promise<boolean> {
                const rt = get(refreshToken);
                if (!rt) return false;
                try {
                        const res = await refreshApi.auth.authRefreshGet({
                                authorization: rt
                        });
                        const t = res.data.token ?? '';
                        const r = normalizeRefreshToken(res.data.refresh_token);
                        if (t) token.set(t);
                        if (r) refreshToken.set(r);
                        scheduleTokenRefresh(t || get(token));
                        return true;
                } catch {
			logout();
			return false;
		}
	}

	const api = createApi(() => get(token), refresh);

	const user = writable<DtoUser | null>(
		typeof localStorage !== 'undefined'
			? (() => {
					try {
						return JSON.parse(localStorage.getItem(USER_KEY) || 'null') as DtoUser | null;
					} catch {
						return null;
					}
				})()
			: null
	);
	user.subscribe((u) => {
		try {
			if (typeof localStorage !== 'undefined') {
				if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
				else localStorage.removeItem(USER_KEY);
			}
		} catch {
			// ignore
		}
	});
	const guilds = writable<DtoGuild[]>([]);

	async function login(data: AuthLoginRequest) {
		const res = await api.auth.authLoginPost({ authLoginRequest: data });
                const t = res.data.token ?? '';
                const r = normalizeRefreshToken(res.data.refresh_token);
                token.set(t);
                refreshToken.set(r);
                return t;
        }

	function logout() {
		clearRefreshTimer();
		token.set(null);
		refreshToken.set(null);
		user.set(null);
		guilds.set([]);
	}

	async function register(data: AuthRegisterRequest) {
		await api.auth.authRegistrationPost({ authRegisterRequest: data });
	}

	async function confirm(data: AuthConfirmationRequest) {
		// confirmation returns token
		const res = await api.auth.authConfirmationPost({ authConfirmationRequest: data });
		const t = (res.data as { token?: string })?.token ?? '';
		if (t) token.set(t);
		return t;
	}

	async function recover(data: AuthPasswordRecoveryRequest) {
		await api.auth.authRecoveryPost({ authPasswordRecoveryRequest: data });
	}

	async function reset(data: AuthPasswordResetRequest) {
		await api.auth.authResetPost({ authPasswordResetRequest: data });
	}

	async function loadMe() {
		if (!get(token)) return null;
		try {
			const res = await api.user.userUserIdGet({ userId: 'me' });
			const me = res.data ?? null;
			user.set(me);
			return me;
		} catch (err) {
			user.set(null);
			const status = (err as { response?: { status?: number } }).response?.status;
			if (status === 401) {
				logout();
				if (browser) window.location.href = '/';
			}
			return null;
		}
	}

        function ingestGuilds(list: unknown): DtoGuild[] {
                const incoming = Array.isArray(list) ? (list as DtoGuild[]) : [];
                const previous = get(guilds);
                const previousMap = new Map<string, any>();
                for (const guild of previous) {
                        const id = toSnowflakeString((guild as any)?.id);
                        if (id) {
                                previousMap.set(id, guild as any);
                        }
                }
                const nextList = incoming.map((guild) => {
                        const id = toSnowflakeString((guild as any)?.id);
                        const base = normalizePermissionValue((guild as any)?.permissions);
                        const prev = id ? previousMap.get(id) : undefined;
                        const prevEffectiveRaw = prev?.__effectivePermissions;
                        const effective =
                                prevEffectiveRaw != null
                                        ? normalizePermissionValue(prevEffectiveRaw)
                                        : base;
                        return {
                                ...guild,
                                __basePermissions: base,
                                __effectivePermissions: effective
                        } as any;
                });
                guilds.set(nextList);
                return nextList;
        }

        async function loadGuilds() {
                if (!get(token)) return [];
                const res = await api.user.userMeGuildsGet();
                return ingestGuilds(res.data ?? []);
        }

	const isAuthenticated = derived(token, (t) => Boolean(t));

	token.subscribe(async (t) => {
		try {
			if (typeof localStorage !== 'undefined') {
				if (t) localStorage.setItem(TOKEN_KEY, t);
				else localStorage.removeItem(TOKEN_KEY);
			}
		} catch {
			// ignore
		}
		scheduleTokenRefresh(t);
                if (t) {
                        await loadMe();
                } else {
                        user.set(null);
                        guilds.set([]);
                }
        });

	refreshToken.subscribe((t) => {
		try {
			if (typeof localStorage !== 'undefined') {
				if (t) localStorage.setItem(REFRESH_KEY, t);
				else localStorage.removeItem(REFRESH_KEY);
			}
		} catch {
			/* ignore */
		}
		if (!t) {
			clearRefreshTimer();
			return;
		}
		const currentToken = get(token);
		if (currentToken) {
			scheduleTokenRefresh(currentToken);
		}
	});

	return {
		token,
		user,
		guilds,
		isAuthenticated,
                api,
                login,
                logout,
                register,
                confirm,
                recover,
                reset,
                loadMe,
                loadGuilds,
                ingestGuilds
        };
}

export const auth = createAuthStore();
