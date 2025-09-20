<script lang="ts">
        import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
        import { goto } from '$app/navigation';
        import { browser } from '$app/environment';
        import type { PageData } from './$types';
        import type { DtoInvitePreview } from '$lib/api';
        import { auth } from '$lib/stores/auth';
        import { channelReady, selectedChannelId, selectedGuildId } from '$lib/stores/appState';
	import {
		buildGuildIconUrl,
		getGuildInitials,
		getGuildName,
		getInviteUnavailableMessage,
		getMemberCountLabel,
		joinGuild as joinGuildAction,
		type InviteState
	} from './invite-utils';

	let { data } = $props<{ data: PageData }>();

	let invite = $state<DtoInvitePreview | null>(data.invite ?? null);
	let inviteCodeValue = $state<string>(data.inviteCode ?? '');
	let inviteState = $state<InviteState>((data.inviteState ?? 'error') as InviteState);

	const isAuthenticated = auth.isAuthenticated;

	let joining = $state(false);
	let joinError = $state<string | null>(null);

	function getHeadTitle(current: DtoInvitePreview | null): string {
		return current?.guild?.name
			? `Join ${current.guild.name} on GoChat`
			: 'Join this GoChat community';
	}

	const guildIconUrl = $derived.by(() => buildGuildIconUrl(invite));
	const guildInitials = $derived.by(() => getGuildInitials(invite));
	const guildName = $derived.by(() => getGuildName(invite));
	const memberCountLabel = $derived.by(() => getMemberCountLabel(invite));
	const inviteMessage = $derived.by(() => getInviteUnavailableMessage(inviteState));

        async function handleJoin() {
                if (!inviteCodeValue || inviteState !== 'ok' || joining) return;
                joining = true;
                joinError = null;
                const result = await joinGuildAction(inviteCodeValue, '/app', {
                        acceptInvite: (params) => auth.api.guildInvites.guildInvitesAcceptInviteCodePost(params),
                        loadGuilds: () => auth.loadGuilds(),
                        goto,
                        onSuccess: ({ guildId, guild }) => {
                                const targetGuildId =
                                        guildId ??
                                        (guild?.id != null
                                                ? String(guild.id)
                                                : invite?.guild?.id != null
                                                        ? String(invite.guild.id)
                                                        : null);
                                selectedGuildId.set(null);
                                selectedChannelId.set(null);
                                channelReady.set(false);
                                if (browser && targetGuildId) {
                                        try {
                                                localStorage.setItem('lastGuild', targetGuildId);
                                        } catch {}
                                }
                        }
                });
                if (!result.success) {
                        joinError = result.message;
                }
                joining = false;
	}

	$effect(() => {
		invite = (data.invite ?? null) as DtoInvitePreview | null;
		inviteCodeValue = data.inviteCode ?? '';
		inviteState = (data.inviteState ?? 'error') as InviteState;
		joinError = null;
	});
</script>

<svelte:head>
	<title>{getHeadTitle(invite)}</title>
</svelte:head>

{#if !$isAuthenticated}
	<AuthGate redirectTo={`/app/i/${inviteCodeValue}`} />
{:else}
	<div class="min-h-screen bg-[var(--bg)] py-10 text-[var(--text)]">
		<div class="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4">
			<div
				class="panel w-full max-w-xl border border-[var(--stroke)] bg-[var(--panel)] p-8 shadow-[var(--shadow-2)]"
			>
				<div class="flex flex-col items-center gap-4 text-center">
					<div
						class="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-[var(--stroke)] bg-[var(--panel-strong)] text-2xl font-semibold"
					>
						{#if guildIconUrl}
							<img
								alt={`Guild icon for ${guildName}`}
								class="h-full w-full object-cover"
								src={guildIconUrl}
							/>
						{:else}
							<span>{guildInitials}</span>
						{/if}
					</div>
					<div class="space-y-1">
						<h1 class="text-2xl font-semibold text-[var(--text)] sm:text-3xl">{guildName}</h1>
						<p class="text-sm text-[var(--muted)]">{memberCountLabel}</p>
					</div>
				</div>

				{#if inviteMessage}
					<div
						class="mt-6 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted)]"
					>
						{inviteMessage}
					</div>
				{/if}

				<div class="mt-6 space-y-3">
					<button
						class="h-11 w-full rounded-md bg-[var(--brand)] font-semibold text-[var(--bg)] transition hover:bg-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
						type="button"
						disabled={inviteState !== 'ok' || joining}
						on:click={handleJoin}
					>
						{joining ? 'Joining…' : 'Join guild'}
					</button>
					{#if joinError}
						<p class="text-sm text-[var(--danger)]">{joinError}</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
