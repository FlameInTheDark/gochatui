import type { PageLoad } from './$types';
import type { DtoInvitePreview } from '$lib/api';
import { computeApiBase } from '$lib/runtime/api';

export const prerender = false;

export const load: PageLoad = async ({ params, fetch }) => {
	const inviteCode = params.invite_code;
	let invite: DtoInvitePreview | null = null;
	let inviteState: 'ok' | 'not-found' | 'error' = 'error';

	const base = computeApiBase('/api/v1');
	const endpoint = `${base}/guild/invites/receive/${encodeURIComponent(inviteCode)}`;

	try {
		const response = await fetch(endpoint, {
			headers: {
				Accept: 'application/json'
			}
		});

		const contentType = response.headers.get('content-type') ?? '';
		const isJson = contentType.toLowerCase().includes('application/json');

		if (response.ok) {
			if (!isJson) {
				console.error('Invite preview response did not return JSON payload', contentType);
				inviteState = 'error';
			} else {
				try {
					invite = (await response.json()) as DtoInvitePreview;
					inviteState = 'ok';
				} catch (parseError) {
					console.error('Failed to parse invite preview response', parseError);
					inviteState = 'error';
				}
			}
		} else if (response.status === 404 && isJson) {
			inviteState = 'not-found';
		} else {
			inviteState = 'error';
		}
	} catch (error) {
		console.error('Failed to load invite preview', error);
		inviteState = 'error';
	}

	return {
		inviteCode,
		invite,
		inviteState
	};
};
