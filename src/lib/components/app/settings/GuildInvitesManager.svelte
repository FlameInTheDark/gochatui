<script lang="ts">
        import { browser } from '$app/environment';
        import { selectedGuildId } from '$lib/stores/appState';
        import { auth } from '$lib/stores/auth';
        import { m } from '$lib/paraglide/messages.js';
        import type { DtoGuildInvite } from '$lib/api';

	let invites = $state<DtoGuildInvite[]>([]);
	let loading = $state(false);
        let creating = $state(false);
        let deletingId = $state<number | null>(null);
        let copyingId = $state<number | null>(null);
        let error: string | null = $state(null);
        type ExpirationPreset = '1h' | '6h' | '12h' | '1d' | '7d' | 'never' | 'custom';
        let selectedExpiration = $state<ExpirationPreset>('7d');
        let customHoursInput = $state('');

        const PRESET_TO_HOURS: Record<Exclude<ExpirationPreset, 'never' | 'custom'>, number> = {
                '1h': 1,
                '6h': 6,
                '12h': 12,
                '1d': 24,
                '7d': 24 * 7
        };

        const FIFTY_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 50;

	async function loadInvites() {
		if (!$selectedGuildId) {
			invites = [];
			return;
		}
		loading = true;
		error = null;
		const currentGuild = $selectedGuildId;
		try {
			const res = await auth.api.guildInvites.guildInvitesGuildIdGet({
				guildId: BigInt(currentGuild) as any
			});
			if (currentGuild === $selectedGuildId) {
				invites = res.data ?? [];
			}
		} catch (err: any) {
			if (currentGuild === $selectedGuildId) {
				error = err?.response?.data?.message ?? err?.message ?? m.invite_error_loading();
			}
		} finally {
			if (currentGuild === $selectedGuildId) {
				loading = false;
			}
		}
	}

        async function createInvite() {
                if (!$selectedGuildId || creating) return;
                let expiresInSec: number | undefined;

                switch (selectedExpiration) {
                        case 'never':
                                expiresInSec = 0;
                                break;
                        case 'custom': {
                                const trimmed = customHoursInput.trim();
                                if (trimmed.length === 0) {
                                        error = m.invite_invalid_custom_expiration();
                                        return;
                                }
                                const parsed = Number(trimmed);
                                if (!Number.isFinite(parsed) || parsed <= 0) {
                                        error = m.invite_invalid_custom_expiration();
                                        return;
                                }
                                expiresInSec = Math.round(parsed * 3600);
                                break;
                        }
                        default:
                                expiresInSec = Math.round(PRESET_TO_HOURS[selectedExpiration] * 3600);
                                break;
                }

                creating = true;
                error = null;
                try {
                        await auth.api.guildInvites.guildInvitesGuildIdPost({
                                guildId: BigInt($selectedGuildId) as any,
                                guildCreateInviteRequest: expiresInSec !== undefined ? { expires_in_sec: expiresInSec } : {}
                        });
                        customHoursInput = '';
                        await loadInvites();
                } catch (err: any) {
                        error = err?.response?.data?.message ?? err?.message ?? m.invite_error_creating();
                } finally {
                        creating = false;
                }
        }

        async function deleteInvite(inviteId?: number) {
		if (inviteId == null || !$selectedGuildId) return;
		deletingId = inviteId;
		error = null;
		try {
			await auth.api.guildInvites.guildInvitesGuildIdInviteIdDelete({
				guildId: BigInt($selectedGuildId) as any,
				inviteId
			});
			await loadInvites();
		} catch (err: any) {
			error = err?.response?.data?.message ?? err?.message ?? m.invite_error_deleting();
		} finally {
			deletingId = null;
                }
        }

        async function copyInvite(invite: DtoGuildInvite) {
                if (!browser || invite?.code == null || invite?.id == null) return;
                copyingId = invite.id;
                error = null;
                try {
                        const url = new URL(`/app/i/${invite.code}`, window.location.origin).toString();
                        await navigator.clipboard.writeText(url);
                } catch (err: any) {
                        error = err?.message ?? m.invite_error_copying();
                } finally {
                        copyingId = null;
                }
        }

	function formatExpires(invite: DtoGuildInvite): string {
		if (!invite.expires_at) {
			return m.invite_unknown_date();
		}
		if (invite.created_at) {
			const created = new Date(invite.created_at);
			const expires = new Date(invite.expires_at);
			if (expires.getTime() - created.getTime() >= FIFTY_YEARS_MS) {
				return m.invite_never_expires();
			}
		}
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(invite.expires_at));
	}

	function formatCreated(invite: DtoGuildInvite): string {
		if (!invite.created_at) {
			return m.invite_unknown_date();
		}
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(invite.created_at));
	}

	$effect(() => {
		const gid = $selectedGuildId;
		if (!gid) {
			invites = [];
			return;
		}
		loadInvites();
	});

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void createInvite();
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-xl font-semibold">{m.invite_manage_title()}</h2>
		<p class="mt-1 text-sm text-[var(--fg-muted)]">{m.invite_manage_description()}</p>
	</div>

	<form class="space-y-3" onsubmit={handleSubmit}>
                <div class="space-y-2">
                        <div>
                                <label class="mb-1 block text-sm font-medium" for="invite-expiration">
                                        {m.invite_expiration_label()}
                                </label>
                                <select
                                        id="invite-expiration"
                                        class="w-full rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
                                        bind:value={selectedExpiration}
                                >
                                        <option value="1h">{m.invite_expiration_option_1h()}</option>
                                        <option value="6h">{m.invite_expiration_option_6h()}</option>
                                        <option value="12h">{m.invite_expiration_option_12h()}</option>
                                        <option value="1d">{m.invite_expiration_option_1d()}</option>
                                        <option value="7d">{m.invite_expiration_option_7d()}</option>
                                        <option value="never">{m.invite_expiration_option_never()}</option>
                                        <option value="custom">{m.invite_expiration_option_custom()}</option>
                                </select>
                        </div>
                        <p class="text-xs text-[var(--fg-muted)]">{m.invite_expiration_help()}</p>
                        {#if selectedExpiration === 'custom'}
                                <div>
                                        <label class="mb-1 block text-sm font-medium" for="invite-custom-hours">
                                                {m.invite_custom_hours_label()}
                                        </label>
                                        <input
                                                id="invite-custom-hours"
                                                class="w-full rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
                                                type="number"
                                                min="1"
                                                step="1"
                                                placeholder={m.invite_custom_hours_placeholder()}
                                                bind:value={customHoursInput}
                                        />
                                </div>
                        {/if}
                </div>
		<div class="flex flex-wrap items-center gap-2">
			<button
				class="rounded bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
				type="submit"
				disabled={creating || !$selectedGuildId}
			>
				{creating ? m.invite_creating() : m.invite_create()}
			</button>
			<button
				class="rounded border border-[var(--stroke)] px-3 py-1.5 text-sm hover:bg-[var(--panel-strong)]"
				type="button"
				onclick={loadInvites}
				disabled={loading}
			>
				{loading ? m.loading() : m.invite_refresh()}
			</button>
		</div>
	</form>

	{#if error}
		<div class="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
			{error}
		</div>
	{/if}

	<div class="overflow-hidden rounded-lg border border-[var(--stroke)]">
		<table class="min-w-full divide-y divide-[var(--stroke)] text-sm">
			<thead
				class="bg-[var(--panel-strong)] text-left text-xs tracking-wide text-[var(--fg-muted)] uppercase"
			>
				<tr>
					<th class="px-3 py-2 font-semibold">{m.invite_table_code()}</th>
					<th class="px-3 py-2 font-semibold">{m.invite_table_created()}</th>
					<th class="px-3 py-2 font-semibold">{m.invite_table_expires()}</th>
					<th class="px-3 py-2 font-semibold">{m.invite_table_actions()}</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-[var(--stroke)] bg-[var(--panel)]">
				{#if loading && invites.length === 0}
					<tr>
						<td class="px-3 py-4 text-center text-[var(--fg-muted)]" colspan="4">
							{m.loading()}
						</td>
					</tr>
				{:else if invites.length === 0}
					<tr>
						<td class="px-3 py-4 text-center text-[var(--fg-muted)]" colspan="4">
							{m.invite_empty_state()}
						</td>
					</tr>
				{:else}
					{#each invites as invite (invite.id)}
						<tr>
							<td class="px-3 py-2 font-mono">{invite.code}</td>
							<td class="px-3 py-2">{formatCreated(invite)}</td>
                                                        <td class="px-3 py-2">{formatExpires(invite)}</td>
                                                        <td class="px-3 py-2">
                                                                <div class="flex flex-wrap gap-2">
                                                                        <button
                                                                                class="rounded border border-[var(--stroke)] px-2 py-1 text-xs font-medium hover:bg-[var(--panel-strong)] disabled:opacity-50"
                                                                                type="button"
                                                                                onclick={() => copyInvite(invite)}
                                                                                disabled={copyingId === invite.id}
                                                                        >
                                                                                {copyingId === invite.id ? m.invite_copying() : m.invite_copy_link()}
                                                                        </button>
                                                                        <button
                                                                                class="rounded border border-red-500/60 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                                                                                type="button"
                                                                                onclick={() => deleteInvite(invite.id)}
                                                                                disabled={deletingId === invite.id}
                                                                        >
                                                                                {deletingId === invite.id ? m.loading() : m.delete()}
                                                                        </button>
                                                                </div>
                                                        </td>
                                                </tr>
                                        {/each}
                                {/if}
			</tbody>
		</table>
	</div>
</div>
