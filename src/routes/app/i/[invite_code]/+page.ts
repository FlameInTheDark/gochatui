import type { PageLoad } from './$types';

type InvitePageData = {
        inviteCode: string;
};

export const load: PageLoad = async ({ params }) => {
        const inviteCode = (params.invite_code ?? '').trim();
        return {
                inviteCode
        } satisfies InvitePageData;
};
