/// <reference types="vitest" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '$lib/runtime/config';

type PageModule = typeof import('./+page');
type LoadFn = PageModule['load'];
type LoadArgs = Parameters<LoadFn>[0];
type LoadResult = Awaited<ReturnType<LoadFn>>;

const guildInvitesReceiveInviteCodeGetMock = vi.fn();

vi.mock('$lib/stores/auth', () => ({
	auth: {
		api: {
			guildInvites: {
				guildInvitesReceiveInviteCodeGet: guildInvitesReceiveInviteCodeGetMock
			}
		}
	}
}));

async function importPageModule(): Promise<PageModule> {
	return import('./+page');
}

function setupWindowWithImmediateConfig(config: RuntimeConfig): void {
	const runtimeWindow = {
		__RUNTIME_CONFIG__: config,
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}
	} as typeof globalThis & {
		__RUNTIME_CONFIG__?: RuntimeConfig;
		requestAnimationFrame: (callback: FrameRequestCallback) => number;
	};

	vi.stubGlobal('window', runtimeWindow);
	(globalThis as typeof globalThis & { __RUNTIME_CONFIG__?: RuntimeConfig }).__RUNTIME_CONFIG__ =
		config;
}

function setupWindowWithDeferredConfig(config: RuntimeConfig): void {
	let frame = 0;
	const runtimeWindow = {
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			frame += 1;
			if (frame === 2) {
				runtimeWindow.__RUNTIME_CONFIG__ = config;
				(
					globalThis as typeof globalThis & { __RUNTIME_CONFIG__?: RuntimeConfig }
				).__RUNTIME_CONFIG__ = config;
			}

			callback(frame);
			return frame;
		}
	} as typeof globalThis & {
		__RUNTIME_CONFIG__?: RuntimeConfig;
		requestAnimationFrame: (callback: FrameRequestCallback) => number;
	};

	runtimeWindow.__RUNTIME_CONFIG__ = undefined;
	vi.stubGlobal('window', runtimeWindow);
	(globalThis as typeof globalThis & { __RUNTIME_CONFIG__?: RuntimeConfig }).__RUNTIME_CONFIG__ =
		undefined;
}

async function executeLoad(
	inviteCode: string
): Promise<{ result: LoadResult; fetch: LoadArgs['fetch'] }> {
	const module = await importPageModule();
	const fetch = vi.fn() as unknown as LoadArgs['fetch'];

	const result = await module.load({
		params: { invite_code: inviteCode },
		fetch
	} as LoadArgs);

	return { result, fetch };
}

describe('invite page load', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		guildInvitesReceiveInviteCodeGetMock.mockReset();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(globalThis as Record<string, unknown>, '__RUNTIME_CONFIG__');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(globalThis as Record<string, unknown>, '__RUNTIME_CONFIG__');
	});

	it('fetches the invite preview through the authenticated API when runtime config is ready', async () => {
		const inviteCode = 'join-me';
		const payload = { code: inviteCode };

		setupWindowWithImmediateConfig({ PUBLIC_API_BASE_URL: 'https://api.example.test' });
		guildInvitesReceiveInviteCodeGetMock.mockResolvedValue({ data: payload });

		const { result, fetch } = await executeLoad(inviteCode);

		expect(fetch).not.toHaveBeenCalled();
		expect(guildInvitesReceiveInviteCodeGetMock).toHaveBeenCalledTimes(1);
		expect(guildInvitesReceiveInviteCodeGetMock).toHaveBeenCalledWith({ inviteCode });

		const loadResult = result as Record<string, unknown>;
		expect(loadResult.invite).toEqual(payload);
		expect(loadResult.inviteState).toBe('ok');
	});

	it('waits for the runtime API base URL before requesting the invite preview', async () => {
		const inviteCode = 'delayed';
		const payload = { code: inviteCode };
		const config = { PUBLIC_API_BASE_URL: 'https://delayed.example.test' } satisfies RuntimeConfig;

		setupWindowWithDeferredConfig(config);
		guildInvitesReceiveInviteCodeGetMock.mockImplementation(() => {
			expect(
				(globalThis as typeof globalThis & { __RUNTIME_CONFIG__?: RuntimeConfig })
					.__RUNTIME_CONFIG__
			).toEqual(config);
			return Promise.resolve({ data: payload });
		});

		const { result } = await executeLoad(inviteCode);

		expect(guildInvitesReceiveInviteCodeGetMock).toHaveBeenCalledTimes(1);
		expect(guildInvitesReceiveInviteCodeGetMock).toHaveBeenCalledWith({ inviteCode });

		const loadResult = result as Record<string, unknown>;
		expect(loadResult.invite).toEqual(payload);
		expect(loadResult.inviteState).toBe('ok');
	});

	it('marks the invite as not found when the API returns a 404 status', async () => {
		const inviteCode = 'missing';

		setupWindowWithImmediateConfig({ PUBLIC_API_BASE_URL: '' });
		guildInvitesReceiveInviteCodeGetMock.mockRejectedValue({
			isAxiosError: true,
			response: { status: 404 }
		});

		const { result } = await executeLoad(inviteCode);

		expect(guildInvitesReceiveInviteCodeGetMock).toHaveBeenCalledWith({ inviteCode });

		const loadResult = result as Record<string, unknown>;
		expect(loadResult.invite).toBeNull();
		expect(loadResult.inviteState).toBe('not-found');
	});
});
