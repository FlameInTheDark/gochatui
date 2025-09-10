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

function createAuthStore() {
  const token = writable<string | null>(typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null);
  token.subscribe((t) => {
    try {
      if (typeof localStorage !== 'undefined') {
        if (t) localStorage.setItem(TOKEN_KEY, t);
        else localStorage.removeItem(TOKEN_KEY);
      }
    } catch {}
  });

  const api = createApi(() => get(token));

  const user = writable<DtoUser | null>(null);
  const guilds = writable<DtoGuild[]>([]);

  async function login(data: AuthLoginRequest) {
    const res = await api.auth.authLoginPost({ authLoginRequest: data });
    const t = res.data.token ?? '';
    token.set(t);
    await loadMe();
    await loadGuilds();
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
    const t = (res.data as any)?.token ?? '';
    if (t) token.set(t);
    await loadMe();
    await loadGuilds();
    return t;
  }

  async function recover(data: AuthPasswordRecoveryRequest) {
    await api.auth.authRecoveryPost({ authPasswordRecoveryRequest: data });
  }

  async function reset(data: AuthPasswordResetRequest) {
    await api.auth.authResetPost({ authPasswordResetRequest: data });
  }

  async function loadMe() {
    try {
      // There is no explicit "me" get; use token via any call that returns user if needed.
      // Fallback: try fetching user id 0 may not work. Skip and rely on guild/member endpoints.
      // Keep the store nullable until user is fetched from other endpoints.
      return null;
    } catch (e) {
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

