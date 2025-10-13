<script lang="ts">
	import type { DtoInvitePreview } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages.js';
	import { computeApiBase } from '$lib/runtime/api';
	import { selectGuild } from '$lib/utils/guildSelection';

	let { code, url } = $props<{ code: string; url: string }>();

	let preview = $state<DtoInvitePreview | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let accepting = $state(false);
	let acceptError = $state<string | null>(null);
	let accepted = $state(false);

	const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
	const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

	const EPOCH_MS = Date.UTC(2008, 10, 10, 23, 0, 0, 0);

	function snowflakeToDate(id: any): Date | null {
		if (id == null) return null;
		try {
			const s = String(id).replace(/[^0-9]/g, '');
			if (!s) return null;
			const v = BigInt(s);
			const ms = Number(v >> 22n);
			return new Date(EPOCH_MS + ms);
		} catch {
			return null;
		}
	}

	function getGuildName(current: DtoInvitePreview | null): string {
		const name = current?.guild?.name?.trim();
		if (name) return name;
		return m.invite_preview_default_name();
	}

	function getGuildInitials(name: string): string {
		const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
		if (parts.length === 0) return '?';
		return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
	}

	const guildName = $derived(getGuildName(preview));
	const guildInitials = $derived(getGuildInitials(guildName));
	const guildIconUrl = $derived.by(() => {
		const iconId = preview?.guild?.icon;
		if (iconId == null) return null;
		const base = computeApiBase();
		return `${base.replace(/\/$/, '')}/attachments/${iconId}`;
	});
	const memberLabel = $derived.by(() => {
		const count = preview?.members_count;
		if (count == null) {
			return m.invite_preview_member_unknown();
		}
		const formatted = numberFormatter.format(count);
		if (count === 1) {
			return m.invite_preview_member_one({ count: formatted });
		}
		return m.invite_preview_member_other({ count: formatted });
	});
	const creationLabel = $derived.by(() => {
		const id = preview?.guild?.id ?? preview?.id;
		const created = snowflakeToDate(id);
		if (!created) return null;
		return m.invite_preview_created({ date: dateFormatter.format(created) });
	});

	async function loadPreview() {
		if (!code) {
			preview = null;
			return;
		}
		loading = true;
		loadError = null;
		preview = null;
		try {
			const res = await auth.api.guildInvites.guildInvitesReceiveInviteCodeGet({
				inviteCode: code
			});
			preview = res.data ?? null;
			if (!preview) {
				loadError = m.invite_preview_error_loading();
			}
		} catch (error) {
			const err = error as {
				response?: { data?: { message?: string } };
				message?: string;
			};
			loadError = err?.response?.data?.message ?? err?.message ?? m.invite_preview_error_loading();
			preview = null;
		} finally {
			loading = false;
		}
	}

	async function acceptInvite() {
		if (!code || accepting || accepted) return;
		accepting = true;
		acceptError = null;
		try {
			const joinedGuildId = preview?.guild?.id;
			await auth.api.guildInvites.guildInvitesAcceptInviteCodePost({ inviteCode: code });
			const loaded = await auth
				.loadGuilds()
				.then(() => true)
				.catch(() => false);
			if (loaded && joinedGuildId != null) {
				const gid = String(joinedGuildId);
				if (gid) {
					await selectGuild(gid);
				}
			}
			accepted = true;
		} catch (error) {
			const err = error as {
				response?: { data?: { message?: string } };
				message?: string;
			};
			acceptError = err?.response?.data?.message ?? err?.message ?? m.invite_preview_error_accept();
		} finally {
			accepting = false;
		}
	}

	$effect(() => {
		code;
		url;
		acceptError = null;
		accepted = false;
		void loadPreview();
	});
</script>

<div
	class="rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-3 text-sm text-[var(--text)] shadow-[var(--shadow-1)]"
>
	{#if loading}
		<p class="text-xs text-[var(--muted)]">{m.invite_preview_loading()}</p>
	{:else if loadError}
		<div class="space-y-2">
			<p class="text-xs text-[var(--muted)]">{loadError}</p>
			<a
				class="inline-flex w-fit items-center gap-1 text-xs font-medium text-[var(--brand)] underline underline-offset-2 transition hover:text-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
				href={url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{m.invite_preview_open_link()}
			</a>
		</div>
	{:else if preview}
		<div class="flex items-center gap-3">
			<div
				class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--stroke)] bg-[var(--panel)] text-base font-semibold"
			>
				{#if guildIconUrl}
					<img alt={guildName} class="h-full w-full object-cover" src={guildIconUrl} />
				{:else}
					<span>{guildInitials}</span>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="truncate font-semibold">{guildName}</div>
				<div class="text-xs text-[var(--muted)]">{memberLabel}</div>
				{#if creationLabel}
					<div class="text-xs text-[var(--muted)]">{creationLabel}</div>
				{/if}
			</div>
			<button
				class="rounded-md bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-[var(--bg)] transition hover:bg-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
				disabled={accepted || accepting}
				type="button"
				on:click={acceptInvite}
			>
				{accepted
					? m.invite_preview_joined()
					: accepting
						? m.invite_preview_accepting()
						: m.invite_preview_accept()}
			</button>
		</div>
		{#if acceptError}
			<p class="mt-2 text-xs text-[var(--danger)]">{acceptError}</p>
		{/if}
	{:else}
		<p class="text-xs text-[var(--muted)]">{m.invite_preview_invalid()}</p>
	{/if}
</div>
