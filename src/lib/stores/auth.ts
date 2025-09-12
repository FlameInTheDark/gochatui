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

const TOKEN_KEY = 'gochat.token';
const USER_KEY = 'gochat.user';

function createAuthStore() {
	const token = writable<string | null>(
		typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
	);
	token.subscribe((t) => {
		try {
			if (typeof localStorage !== 'undefined') {
				if (t) localStorage.setItem(TOKEN_KEY, t);
				else localStorage.removeItem(TOKEN_KEY);
			}
		} catch {
			// ignore
		}
	});

	const api = createApi(() => get(token));

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
		token.set(t);
		return t;
	}

	function logout() {
		token.set(null);
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
		} catch {
			user.set(null);
			return null;
		}
	}

	async function loadGuilds() {
		if (!get(token)) return [];
		const res = await api.user.userMeGuildsGet();
		guilds.set(res.data ?? []);
		return res.data ?? [];
	}

	const isAuthenticated = derived(token, (t) => Boolean(t));

	token.subscribe(async (t) => {
		if (t) {
			await loadMe();
			await loadGuilds();
		} else {
			user.set(null);
			guilds.set([]);
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
		loadGuilds
	};
}

export const auth = createAuthStore();
