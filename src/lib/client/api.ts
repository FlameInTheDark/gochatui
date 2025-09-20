import { Configuration } from '$lib/api';
import {
	AuthApi,
	GuildApi,
	GuildInvitesApi,
	MessageApi,
	SearchApi,
	UserApi,
	WebhookApi,
	SearchApiFactory
} from '$lib/api';
import axios, { type AxiosInstance } from 'axios';
import { env as publicEnv } from '$env/dynamic/public';
import { getRuntimeConfig } from '$lib/runtime/config';

// Stringify payloads so bigint values emit as int64 numbers instead of quoted strings
function stringifyBigInt(data: unknown): string {
	return JSON.stringify(
		data,
		(_, v) => (typeof v === 'bigint' ? v.toString() + '#bigint' : v)
        ).replace(/"(-?\d+)#bigint"/g, '$1');
}

// Centralized API client factory using the generated OpenAPI client.
// Injects the bearer token dynamically via configuration.accessToken.

export type ApiGroup = {
        auth: AuthApi;
        guild: GuildApi;
	guildInvites: GuildInvitesApi;
        message: MessageApi;
        search: ReturnType<typeof SearchApiFactory>;
        user: UserApi;
	webhook: WebhookApi;
};

function computeApiBase(): string {
        const runtime = getRuntimeConfig();
        const runtimeConfigured = runtime?.PUBLIC_API_BASE_URL?.trim();
        if (runtimeConfigured && runtimeConfigured.length > 0) {
		return runtimeConfigured.replace(/\/+$/, '');
        }
        const configured = ((publicEnv?.PUBLIC_API_BASE_URL as string | undefined) || undefined)?.trim();
        if (configured && configured.length > 0) {
		return configured.replace(/\/+$/, '');
        }
        // Fallback: explicit localhost for both browser and SSR to avoid relying on a dev proxy
	return 'http://localhost/api/v1';
}

export function createApi(
	getToken: () => string | null,
	refresh?: () => Promise<boolean>
): ApiGroup {
	const basePath = computeApiBase();
        const config = new Configuration({
		basePath
        });

        // The generated OpenAPI client will JSON.stringify payloads before our axios
        // transform runs, which breaks when the payload contains bigint values.
        // Override the JSON MIME detection so the generator skips its own
        // serialization step and lets our custom transformer handle it.
        config.isJsonMime = () => false;

        // Create a dedicated axios instance with an auth interceptor
        const ax: AxiosInstance = axios.create();
        ax.defaults.transformRequest = [
		(data, headers) => {
		        if (data != null && typeof data === 'object') {
		                (headers as any)['Content-Type'] = 'application/json';
		                return stringifyBigInt(data);
		        }
		        return data;
		}
        ];

        // Preserve large int64 values as strings to avoid precision loss
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
			// potential number start
			if (ch === '-' || (ch >= '0' && ch <= '9')) {
				// look back for previous non-space
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

	ax.defaults.transformResponse = [
		function (data) {
			if (typeof data !== 'string') return data;
			const trimmed = data.trim();
			if (!trimmed) return data;
			if (trimmed[0] === '{' || trimmed[0] === '[') {
				try {
					return parseJSONPreserveLargeInts(trimmed);
				} catch {
					/* fallthrough */
				}
				try {
					return JSON.parse(trimmed);
				} catch {
					return data;
				}
			}
			return data;
		}
	];
	function decodeExp(t: string): number | null {
		try {
			const part = t.split('.')[1] || '';
			const json =
				typeof atob === 'function' ? atob(part) : Buffer.from(part, 'base64').toString('utf8');
			const payload = JSON.parse(json) as { exp?: number };
			return typeof payload.exp === 'number' ? payload.exp : null;
		} catch {
			return null;
		}
	}

	ax.interceptors.request.use(async (req) => {
		let t = getToken();
		if (t) {
			const exp = decodeExp(t);
			if (exp && Date.now() >= exp * 1000 && refresh) {
				const ok = await refresh();
				if (ok) t = getToken();
			}
			if (t) {
				req.headers = { ...(req.headers || {}), Authorization: `Bearer ${t}` } as any;
			}
		}
		return req;
	});

	ax.interceptors.response.use(
		(res) => res,
		async (error) => {
			const status = error?.response?.status;
			if (status === 401 && refresh && !error.config?._retry) {
				error.config._retry = true;
				const ok = await refresh();
				if (ok) {
					const t = getToken();
					if (t) error.config.headers.Authorization = `Bearer ${t}`;
					return ax(error.config);
				}
			}
			throw error;
		}
	);

	const base = config.basePath ?? basePath;

	const search = SearchApiFactory(config, base, ax);

	return {
		auth: new AuthApi(config, base, ax),
		guild: new GuildApi(config, base, ax),
		guildInvites: new GuildInvitesApi(config, base, ax),
		message: new MessageApi(config, base, ax),
		search,
		user: new UserApi(config, base, ax),
		webhook: new WebhookApi(config, base, ax)
	};
}
