import type { PageLoad } from './$types';
import type { DtoInvitePreview } from '$lib/api';
import { env as publicEnv } from '$env/dynamic/public';

export const prerender = false;

function sanitizeBase(url: string | undefined | null): string | null {
        if (!url) return null;
        const trimmed = url.trim();
        if (!trimmed) return null;
        return trimmed.replace(/\/+$/, '');
}

export const load: PageLoad = async ({ params, fetch }) => {
        const inviteCode = params.invite_code;
        let invite: DtoInvitePreview | null = null;
        let inviteState: 'ok' | 'not-found' | 'error' = 'error';

        const baseFromEnv = sanitizeBase(publicEnv?.PUBLIC_API_BASE_URL as string | undefined);
        const base = baseFromEnv ?? '/api/v1';
        const endpoint = `${base}/guild/invites/receive/${encodeURIComponent(inviteCode)}`;

        try {
                const response = await fetch(endpoint, {
                        headers: {
                                Accept: 'application/json'
                        }
                });

                if (response.ok) {
                        invite = (await response.json()) as DtoInvitePreview;
                        inviteState = 'ok';
                } else if (response.status === 404) {
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
