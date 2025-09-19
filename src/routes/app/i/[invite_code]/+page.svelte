<script lang="ts">
	import type { PageData } from './$types';
	import { m } from '$lib/paraglide/messages.js';

	let { data }: { data: PageData } = $props();

	const invite = $derived(data.invite);
	const loadError = $derived(data.error);

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
</script>

<svelte:head>
	<title>{m.invite_page_title()}</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--fg)]">
	<div
		class="w-full max-w-lg rounded-xl border border-[var(--stroke)] bg-[var(--panel)] p-8 shadow-xl"
	>
		<h1 class="text-2xl font-semibold">{m.invite_heading()}</h1>
		{#if invite}
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
			<div class="mt-8 flex flex-wrap items-center justify-between gap-3">
				<a
					class="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
					href="/app"
				>
					{m.invite_open_app()}
				</a>
			</div>
		{:else}
			<div
				class="mt-4 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-6 text-center"
			>
				<h2 class="text-lg font-semibold">{m.invite_not_found_title()}</h2>
				<p class="mt-2 text-sm text-[var(--fg-muted)]">
					{loadError ?? m.invite_not_found_message()}
				</p>
			</div>
		{/if}
	</div>
</div>
