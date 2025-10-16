import type { PageLoad } from './$types';
import type { DtoInvitePreview } from '$lib/api';
import { getRuntimeConfig } from '$lib/runtime/config';
import { auth } from '$lib/stores/auth';
import { isAxiosError } from 'axios';

let runtimeConfigReady: Promise<void> | null = null;

function isRuntimeApiBaseDefined(): boolean {
	const config = getRuntimeConfig();
	return Boolean(config && config.PUBLIC_API_BASE_URL !== undefined);
}

function waitForRuntimeApiBase(): Promise<void> {
	if (typeof window === 'undefined') {
		return Promise.resolve();
	}

	if (isRuntimeApiBaseDefined()) {
		return Promise.resolve();
	}

	if (!runtimeConfigReady) {
		runtimeConfigReady = new Promise((resolve) => {
			const check = () => {
				if (isRuntimeApiBaseDefined()) {
					resolve();
					return;
				}

				window.requestAnimationFrame(check);
			};

			window.requestAnimationFrame(check);
		});
	}

	return runtimeConfigReady;
}

export const prerender = false;
export const ssr = false;

export const load: PageLoad = async ({ params }) => {
	const inviteCode = params.invite_code;

	let invite: DtoInvitePreview | null = null;
	let inviteState: 'ok' | 'not-found' | 'error' = 'error';

	await waitForRuntimeApiBase();
	try {
		const response = await auth.api.guildInvites.guildInvitesReceiveInviteCodeGet({
			inviteCode
		});

		const inviteData = response.data ?? null;

		if (inviteData) {
			invite = inviteData;
			inviteState = 'ok';
		} else {
			console.error('Invite preview response did not include a payload');
			inviteState = 'error';
		}
	} catch (error) {
		if (isAxiosError(error) && error.response?.status === 404) {
			inviteState = 'not-found';
		} else {
			console.error('Failed to load invite preview', error);
			inviteState = 'error';
		}
	}

	return {
		inviteCode,
		invite,
		inviteState
	};
};
