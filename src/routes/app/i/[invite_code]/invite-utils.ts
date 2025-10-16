import type { DtoGuild, DtoInvitePreview } from '$lib/api';
import { computeApiBase } from '$lib/runtime/api';

export type InviteState = 'ok' | 'not-found' | 'error';

const memberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function getGuildName(invite: DtoInvitePreview | null): string {
	return invite?.guild?.name?.trim() || 'GoChat community';
}

export function getGuildInitials(invite: DtoInvitePreview | null): string {
	const name = getGuildName(invite);
	const segments = name.split(/\s+/).filter(Boolean).slice(0, 2);
	if (segments.length === 0) return '?';
	return segments.map((segment) => segment[0]?.toUpperCase() ?? '').join('') || '?';
}

export function getMemberCountLabel(invite: DtoInvitePreview | null): string {
	const count = invite?.members_count;
	if (count == null) return 'Member count unavailable';
	if (count === 1) return '1 member';
	return `${memberFormatter.format(count)} members`;
}

export function buildGuildIconUrl(invite: DtoInvitePreview | null): string | null {
	const iconId = invite?.guild?.icon;
	if (iconId == null) return null;
	const base = computeApiBase();
	const normalized = base.replace(/\/$/, '');
	return `${normalized}/attachments/${iconId}`;
}

export function getInviteUnavailableMessage(state: InviteState): string | null {
	if (state === 'ok') return null;
	if (state === 'not-found') {
		return 'This invite is no longer available or may have expired.';
	}
	return 'We were unable to load the invite details. Please try again later.';
}

export type JoinGuildDeps = {
	acceptInvite: (params: { inviteCode: string }) => Promise<unknown>;
	loadGuilds: () => Promise<unknown>;
	goto: (path: string) => Promise<unknown> | unknown;
	onSuccess?: (context: {
		guildId: string | null;
		guild: DtoGuild | null;
	}) => Promise<unknown> | unknown;
};

type AcceptInviteResponse = { data?: DtoGuild | null };

export async function joinGuild(
	inviteCode: string,
	destination: string,
	deps: JoinGuildDeps
): Promise<{ success: true } | { success: false; message: string }> {
	try {
		const response = (await deps.acceptInvite({ inviteCode })) as AcceptInviteResponse;
		const guild = response?.data ?? null;
		const guildId = guild?.id != null ? String(guild.id) : null;
		await deps.loadGuilds().catch(() => {});
		if (deps.onSuccess) {
			await deps.onSuccess({ guildId, guild });
		}
		await deps.goto(destination);
		return { success: true };
	} catch (error) {
		const err = error as {
			response?: { data?: { message?: string } };
			message?: string;
		};
		return {
			success: false,
			message: err?.response?.data?.message ?? err?.message ?? 'Failed to join guild'
		};
	}
}
