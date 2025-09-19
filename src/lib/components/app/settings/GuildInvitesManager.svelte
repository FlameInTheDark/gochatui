<script lang="ts">
	import { selectedGuildId } from '$lib/stores/appState';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages.js';
	import type { DtoGuildInvite } from '$lib/api';

	let invites = $state<DtoGuildInvite[]>([]);
	let loading = $state(false);
	let creating = $state(false);
	let deletingId = $state<number | null>(null);
	let error: string | null = $state(null);
	let expiresInHoursInput = $state('');

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
		const trimmed = expiresInHoursInput.trim();
		let expiresInSec: number | undefined;
		if (trimmed.length > 0) {
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed) || parsed < 0) {
				error = m.invite_invalid_expiration();
				return;
			}
			if (parsed === 0) {
				expiresInSec = 0;
			} else {
				expiresInSec = Math.round(parsed * 3600);
			}
		}

		creating = true;
		error = null;
		try {
			await auth.api.guildInvites.guildInvitesGuildIdPost({
				guildId: BigInt($selectedGuildId) as any,
				guildCreateInviteRequest: expiresInSec !== undefined ? { expires_in_sec: expiresInSec } : {}
			});
			expiresInHoursInput = '';
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
		<div>
			<label class="mb-1 block text-sm font-medium" for="invite-expires">
				{m.invite_expires_in_hours_label()}
			</label>
			<input
				id="invite-expires"
				class="w-full rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
				type="number"
				min="0"
				step="1"
				placeholder={m.invite_expires_in_hours_placeholder()}
				bind:value={expiresInHoursInput}
			/>
			<p class="mt-1 text-xs text-[var(--fg-muted)]">{m.invite_expires_in_hours_help()}</p>
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
								<button
									class="rounded border border-red-500/60 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-50"
									type="button"
									onclick={() => deleteInvite(invite.id)}
									disabled={deletingId === invite.id}
								>
									{deletingId === invite.id ? m.loading() : m.delete()}
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>
