<script lang="ts">
        import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
        import { goto } from '$app/navigation';
        import { browser } from '$app/environment';
        import { auth } from '$lib/stores/auth';
        import type { DtoInvitePreview } from '$lib/api';
        import type { PageData } from './$types';
        import { m } from '$lib/paraglide/messages.js';

        export let data: PageData;

        const isAuthenticated = auth.isAuthenticated;

        let inviteCode = data.inviteCode;
        let invite: DtoInvitePreview | null = null;
        let loadError: string | null = null;
        let loadingInvite = false;
        let currentInviteCode: string | null = null;
        let inFlightInviteCode: string | null = null;

        let joining = false;
        let joinError: string | null = null;
        let joinSuccess = false;

        const FIFTY_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 50;

        function parseIsoDate(iso?: string | null) {
                if (!iso) return null;
                const date = new Date(iso);
                return Number.isNaN(date.getTime()) ? null : date;
        }

        let expiresLabel: string | null = null;
        let createdLabel: string | null = null;
        let membersLabel: string | null = null;

        $: inviteCode = data.inviteCode;

        $: {
                const currentInvite = invite;
                if (!currentInvite) {
                        expiresLabel = null;
                } else {
                        const created = parseIsoDate(currentInvite.created_at);
                        const expires = parseIsoDate(currentInvite.expires_at);
                        if (!expires) {
                                expiresLabel = null;
                        } else if (created && expires.getTime() - created.getTime() >= FIFTY_YEARS_MS) {
                                expiresLabel = m.invite_never_expires();
                        } else {
                                expiresLabel = new Intl.DateTimeFormat(undefined, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                }).format(expires);
                        }
                }
        }

        $: {
                const created = parseIsoDate(invite?.created_at ?? null);
                createdLabel = created
                        ? new Intl.DateTimeFormat(undefined, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                }).format(created)
                        : null;
        }

        $: {
                const count = invite?.members_count ?? 0;
                const formatted = new Intl.NumberFormat(undefined).format(count);
                membersLabel = m.invite_member_count({ count: formatted });
        }

        async function fetchInvite(code: string) {
                inFlightInviteCode = code;
                loadingInvite = true;
                loadError = null;
                joinError = null;
                joinSuccess = false;
                try {
                        const res = await auth.api.guildInvites.guildInvitesReceiveInviteCodeGet({
                                inviteCode: code
                        });
                        const preview = res.data ?? null;
                        invite = preview;
                        if (!preview) {
                                loadError = m.invite_not_found_message();
                        }
                } catch (err: any) {
                        invite = null;
                        loadError = err?.response?.data?.message ?? err?.message ?? m.invite_not_found_message();
                } finally {
                        loadingInvite = false;
                        currentInviteCode = code;
                        inFlightInviteCode = null;
                }
        }

        $: {
                if (!$isAuthenticated) {
                        invite = null;
                        loadError = null;
                        loadingInvite = false;
                        currentInviteCode = null;
                        inFlightInviteCode = null;
                } else {
                        const code = inviteCode;
                        if (!code) {
                                invite = null;
                                loadError = m.invite_not_found_message();
                                loadingInvite = false;
                                currentInviteCode = null;
                                inFlightInviteCode = null;
                        } else if (code !== currentInviteCode && code !== inFlightInviteCode) {
                                void fetchInvite(code);
                        }
                }
        }

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

<AuthGate>
        <div class="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--fg)]">
                <div
                        class="w-full max-w-lg rounded-xl border border-[var(--stroke)] bg-[var(--panel)] p-8 shadow-xl"
                >
                        <h1 class="text-2xl font-semibold">{m.invite_heading()}</h1>
                        {#if loadingInvite}
                                <div class="mt-6 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-6 text-center text-sm text-[var(--fg-muted)]">
                                        {m.loading()}
                                </div>
                        {:else if invite}
                                <div class="mt-2 space-y-6">
                                        <p class="text-sm text-[var(--fg-muted)]">{m.invite_description()}</p>
                                        <div class="space-y-4">
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
                                        <div class="space-y-3">
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
                        {:else}
                                <div class="mt-4 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-6 text-center">
                                        <h2 class="text-lg font-semibold">{m.invite_not_found_title()}</h2>
                                        <p class="mt-2 text-sm text-[var(--fg-muted)]">
                                                {loadError ?? m.invite_not_found_message()}
                                        </p>
                                </div>
                        {/if}
                </div>
        </div>
</AuthGate>
