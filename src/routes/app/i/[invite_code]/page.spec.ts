/// <reference types="vitest" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '$lib/runtime/config';

type FetchResponse = {
	ok: boolean;
	status: number;
	headers: {
		get: (name: string) => string | null;
	};
	json: () => Promise<unknown>;
};

type PageModule = typeof import('./+page');
type LoadFn = PageModule['load'];
type LoadArgs = Parameters<LoadFn>[0];
type LoadResult = Awaited<ReturnType<LoadFn>>;

async function importPageModule(): Promise<PageModule> {
	return import('./+page');
}

function setupWindowWithConfig(config: RuntimeConfig): void {
	const runtimeWindow = {
		__RUNTIME_CONFIG__: config,
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}
	} as Window & typeof globalThis & { __RUNTIME_CONFIG__?: RuntimeConfig };

	(globalThis as typeof globalThis & { window: typeof runtimeWindow }).window = runtimeWindow;
	(globalThis as typeof globalThis & { __RUNTIME_CONFIG__?: RuntimeConfig }).__RUNTIME_CONFIG__ =
		config;
}

function createFetchMock(payload: unknown): LoadArgs['fetch'] {
	const response: FetchResponse = {
		ok: true,
		status: 200,
		headers: {
			get: vi.fn().mockReturnValue('application/json')
		},
		json: vi.fn().mockResolvedValue(payload)
	};

	const fetch = vi.fn(async () => response as unknown as Response) as unknown as LoadArgs['fetch'];

	return fetch;
}

async function executeLoad(
	config: RuntimeConfig,
	inviteCode: string
): Promise<{ result: LoadResult; fetch: LoadArgs['fetch'] }> {
	setupWindowWithConfig(config);
	const module = await importPageModule();
	const fetch = createFetchMock({ code: inviteCode });

	const result = await module.load({
		params: { invite_code: inviteCode },
		fetch
	} as LoadArgs);

	return { result, fetch };
}

describe('invite page load', () => {
	beforeEach(() => {
		vi.resetModules();
		Reflect.deleteProperty(globalThis as Record<string, unknown>, 'window');
		Reflect.deleteProperty(globalThis as Record<string, unknown>, '__RUNTIME_CONFIG__');
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis as Record<string, unknown>, 'window');
		Reflect.deleteProperty(globalThis as Record<string, unknown>, '__RUNTIME_CONFIG__');
	});

	it('renders when runtime API base URL is provided', async () => {
		const inviteCode = 'join-me';
		const apiBase = 'https://api.example.test';

		const { result, fetch } = await executeLoad({ PUBLIC_API_BASE_URL: apiBase }, inviteCode);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			`${apiBase}/guild/invites/receive/${encodeURIComponent(inviteCode)}`,
			expect.objectContaining({
				headers: {
					Accept: 'application/json'
				}
			})
		);
		const loadResult = result as Record<string, unknown>;
		expect(loadResult.inviteState).toBe('ok');
	});

	it('renders when runtime API base URL is configured as an empty string', async () => {
		const inviteCode = 'join-me';

		const { result, fetch } = await executeLoad({ PUBLIC_API_BASE_URL: '' }, inviteCode);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			`/api/v1/guild/invites/receive/${encodeURIComponent(inviteCode)}`,
			expect.objectContaining({
				headers: {
					Accept: 'application/json'
				}
			})
		);
		const loadResult = result as Record<string, unknown>;
		expect(loadResult.inviteState).toBe('ok');
	});
});
