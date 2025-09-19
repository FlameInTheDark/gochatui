import { createApi } from '$lib/client/api';
import type { DtoInvitePreview } from '$lib/api';
import type { PageLoad } from './$types';

type InvitePageData = {
	invite: DtoInvitePreview | null;
	error: string | null;
};

export const load: PageLoad = async ({ params }) => {
	const api = createApi(() => null);
	try {
		const res = await api.guildInvites.guildInvitesReceiveInviteCodeGet({
			inviteCode: params.invite_code
		});
		const invite = res.data ?? null;
		return {
			invite,
			error: null
		} satisfies InvitePageData;
	} catch (error: any) {
		const message = error?.response?.data?.message ?? error?.message ?? null;
		return {
			invite: null,
			error: message
		} satisfies InvitePageData;
	}
};
