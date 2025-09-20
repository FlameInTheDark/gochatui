<script lang="ts">
        import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
        import { goto } from '$app/navigation';
        import { browser } from '$app/environment';
        import { auth } from '$lib/stores/auth';
        import type { PageData } from './$types';
        import { m } from '$lib/paraglide/messages.js';

        let { data }: { data: PageData } = $props();

        const invite = $derived(data.invite);
        const loadError = $derived(data.error);

        let joining = $state(false);
        let joinError: string | null = $state(null);
        let joinSuccess = $state(false);

        const FIFTY_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 50;

        function parseIsoDate(iso?: string | null) {
                if (!iso) return null;
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	const expiresLabel = $derived(() => {
		const currentInvite = invite;
		if (!currentInvite) return null;
		const created = parseIsoDate(currentInvite.created_at);
		const expires = parseIsoDate(currentInvite.expires_at);
		if (!expires) return null;
		if (created && expires.getTime() - created.getTime() >= FIFTY_YEARS_MS) {
			return m.invite_never_expires();
		}
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(expires);
	});

	const createdLabel = $derived(() => {
		const created = parseIsoDate(invite?.created_at);
		if (!created) return null;
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(created);
	});

	const membersLabel = $derived(() => {
                const count = invite?.members_count ?? 0;
                const formatted = new Intl.NumberFormat(undefined).format(count);
                return m.invite_member_count({ count: formatted });
        });

        async function joinInvite() {
                const currentInvite = invite;
                if (!currentInvite || joining) return;
                const code = currentInvite.code;
                if (!code) {
                        joinError = m.invite_join_error();
                        joinSuccess = false;
                        return;
                }
                joining = true;
                joinError = null;
                joinSuccess = false;
                try {
                        const res = await auth.api.guildInvites.guildInvitesAcceptInviteCodePost({
                                inviteCode: code
                        });
                        const guild = res.data ?? null;
                        joinSuccess = true;
                        if (browser) {
                                try {
                                        const id = guild && (guild as any).id != null ? String((guild as any).id) : null;
                                        if (id) localStorage.setItem('lastGuild', id);
                                } catch {}
                        }
                        try {
                                await auth.loadGuilds();
                        } catch {}
                        await goto('/app');
                } catch (err: any) {
                        joinSuccess = false;
                        joinError = err?.response?.data?.message ?? err?.message ?? m.invite_join_error();
                } finally {
                        joining = false;
                }
        }
</script>

<svelte:head>
        <title>{m.invite_page_title()}</title>
</svelte:head>

{#if invite}
        <AuthGate>
                <div class="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--fg)]">
                        <div
                                class="w-full max-w-lg rounded-xl border border-[var(--stroke)] bg-[var(--panel)] p-8 shadow-xl"
                        >
                                <h1 class="text-2xl font-semibold">{m.invite_heading()}</h1>
                                <p class="mt-2 text-sm text-[var(--fg-muted)]">{m.invite_description()}</p>
                                <div class="mt-6 space-y-4">
                                        <div>
                                                <div class="text-xs tracking-wide text-[var(--fg-muted)] uppercase">
                                                        {m.invite_server_label()}
                                                </div>
                                                <div class="mt-1 text-lg font-medium">
                                                        {invite.guild?.name ?? m.invite_unknown_server()}
                                                </div>
                                                <div class="text-sm text-[var(--fg-muted)]">{membersLabel}</div>
                                        </div>
                                        <div class="grid gap-4 md:grid-cols-2">
                                                <div>
                                                        <div class="text-xs tracking-wide text-[var(--fg-muted)] uppercase">
                                                                {m.invite_code_label()}
                                                        </div>
                                                        <div
                                                                class="mt-1 rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 font-mono text-sm"
                                                        >
                                                                {invite.code}
                                                        </div>
                                                </div>
                                                <div>
                                                        <div class="text-xs tracking-wide text-[var(--fg-muted)] uppercase">
                                                                {m.invite_created_label()}
                                                        </div>
                                                        <div
                                                                class="mt-1 rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm"
                                                        >
                                                                {createdLabel ?? m.invite_unknown_date()}
                                                        </div>
                                                </div>
                                                <div>
                                                        <div class="text-xs tracking-wide text-[var(--fg-muted)] uppercase">
                                                                {m.invite_expires_label()}
                                                        </div>
                                                        <div
                                                                class="mt-1 rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm"
                                                        >
                                                                {expiresLabel ?? m.invite_unknown_date()}
                                                        </div>
                                                </div>
                                        </div>
                                </div>
                                <div class="mt-8 space-y-3">
                                        <div class="flex flex-wrap items-center gap-3">
                                                <button
                                                        class="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                                                        type="button"
                                                        disabled={joining}
                                                        onclick={() => void joinInvite()}
                                                >
                                                        {joining ? m.invite_joining() : m.invite_join()}
                                                </button>
                                                <a
                                                        class="inline-flex items-center justify-center rounded-lg border border-[var(--stroke)] px-4 py-2 text-sm font-medium hover:bg-[var(--panel-strong)]"
                                                        href="/app"
                                                >
                                                        {m.invite_open_app()}
                                                </a>
                                        </div>
                                        {#if joinError}
                                                <div class="w-full rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                                        {joinError}
                                                </div>
                                        {:else if joinSuccess}
                                                <div class="w-full rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                                                        {m.invite_join_success()}
                                                </div>
                                        {/if}
                                </div>
                        </div>
                </div>
        </AuthGate>
{:else}
        <div class="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--fg)]">
                <div
                        class="w-full max-w-lg rounded-xl border border-[var(--stroke)] bg-[var(--panel)] p-8 shadow-xl"
                >
                        <h1 class="text-2xl font-semibold">{m.invite_heading()}</h1>
                        <div
                                class="mt-4 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-6 text-center"
                        >
                                <h2 class="text-lg font-semibold">{m.invite_not_found_title()}</h2>
                                <p class="mt-2 text-sm text-[var(--fg-muted)]">
                                        {loadError ?? m.invite_not_found_message()}
                                </p>
                        </div>
                </div>
        </div>
{/if}
