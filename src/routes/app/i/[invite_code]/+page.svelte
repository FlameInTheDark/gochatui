<script lang="ts">
	import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import type { DtoInvitePreview } from '$lib/api';

	let { data } = $props<{ data: PageData }>();

	type InviteState = 'ok' | 'not-found' | 'error';

	let invite = $state<DtoInvitePreview | null>(data.invite ?? null);
	let inviteCodeValue = $state<string>(data.inviteCode ?? '');
	let inviteState = $state<InviteState>((data.inviteState ?? 'error') as InviteState);

	const compactNumber = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	const standardNumber = new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 0
	});
	const dateTime = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function formatMemberCount(count: number | null): string {
		if (count == null) return 'Member count unavailable';
		if (count === 0) return 'No members yet';
		if (count === 1) return '1 member';
		if (count < 1000) return `${standardNumber.format(count)} members`;
		return `${compactNumber.format(count)} members`;
	}

	function createMemberDescription(count: number | null): string {
		if (count == null) return 'Sign in or create an account to continue.';
		if (count === 0) return 'Be the first to start the conversation.';
		if (count === 1) return 'One person is already inside — come say hi!';
		if (count < 10) return `${standardNumber.format(count)} members are ready to welcome you.`;
		if (count < 1000)
			return `Join ${standardNumber.format(count)} members collaborating in this space.`;
		return `Join ${compactNumber.format(count)} members collaborating in this space.`;
	}

	function formatDate(value: string | null | undefined): string | null {
		if (!value) return null;
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return null;
		return dateTime.format(parsed);
	}

	function getDisplayName(current: DtoInvitePreview | null): string {
		return current?.guild?.name?.trim() || 'GoChat community';
	}

	function getMemberCount(current: DtoInvitePreview | null): number | null {
		return current?.members_count ?? null;
	}

	function getMemberCountLabel(current: DtoInvitePreview | null): string {
		return formatMemberCount(getMemberCount(current));
	}

	function getMemberDescription(current: DtoInvitePreview | null): string {
		return createMemberDescription(getMemberCount(current));
	}

	function getCreatedLabel(current: DtoInvitePreview | null): string {
		return formatDate(current?.created_at) ?? 'Created recently';
	}

	function isInviteExpired(current: DtoInvitePreview | null): boolean {
		if (!current?.expires_at) return false;
		const parsed = new Date(current.expires_at);
		return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
	}

	function getInviteStatusLabel(state: InviteState, current: DtoInvitePreview | null): string {
		if (state === 'not-found') return 'Unavailable';
		if (state === 'error') return 'Status unknown';
		return isInviteExpired(current) ? 'Expired' : 'Active';
	}

	function getInviteStatusDescriptor(state: InviteState, current: DtoInvitePreview | null): string {
		if (state === 'not-found') return 'This invite could not be found or has been revoked.';
		if (state === 'error') return 'Unable to verify the invite status right now.';
		if (!current?.expires_at) return 'No expiration date';
		const formatted = formatDate(current.expires_at);
		if (!formatted) return 'Expiration unknown';
		return isInviteExpired(current) ? `Expired on ${formatted}` : `Expires on ${formatted}`;
	}

	function getStatusTone(
		state: InviteState,
		current: DtoInvitePreview | null
	): 'success' | 'danger' | 'warning' {
		if (state === 'ok') {
			return isInviteExpired(current) ? 'danger' : 'success';
		}
		return state === 'not-found' ? 'danger' : 'warning';
	}

	function getInviteUnavailableMessage(state: InviteState): string | null {
		if (state === 'ok') return null;
		if (state === 'not-found') return 'This invite is no longer available or may have expired.';
		return 'We were unable to load the invite details. Please try again or contact the guild owner.';
	}

	function getHeadTitle(current: DtoInvitePreview | null): string {
		return current?.guild?.name
			? `Join ${current.guild.name} on GoChat`
			: 'Join this GoChat community';
	}

	let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyCode() {
		if (!inviteCodeValue || !browser) return;
		try {
			await navigator.clipboard.writeText(inviteCodeValue);
			copyStatus = 'copied';
		} catch (error) {
			console.error('Failed to copy invite code', error);
			copyStatus = 'error';
		}

		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copyStatus = 'idle';
		}, 2400);
	}

	onDestroy(() => {
		if (copyTimer) clearTimeout(copyTimer);
	});

	$effect(() => {
		invite = (data.invite ?? null) as DtoInvitePreview | null;
		inviteCodeValue = data.inviteCode ?? '';
		inviteState = (data.inviteState ?? 'error') as InviteState;
	});

	$effect(() => {
		inviteCodeValue;
		copyStatus = 'idle';
		if (copyTimer) {
			clearTimeout(copyTimer);
			copyTimer = null;
		}
	});
</script>

<svelte:head>
	<title>{getHeadTitle(invite)}</title>
</svelte:head>

<div class="relative isolate min-h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
	<div class="pointer-events-none absolute inset-0 -z-10">
		<div
			class="absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-indigo-500/25 blur-3xl"
		></div>
		<div
			class="absolute right-[-12rem] bottom-[-18rem] h-[36rem] w-[36rem] rounded-full bg-fuchsia-500/20 blur-3xl"
		></div>
		<div
			class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.08),transparent_65%)]"
		></div>
	</div>

	<header class="relative border-b border-[var(--stroke)] bg-[var(--panel)]/60 backdrop-blur">
		<div
			class="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5"
		>
			<a class="flex items-center gap-3 text-[var(--text)] no-underline" href="/">
				<span
					class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-tr from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg"
					aria-hidden="true"
				>
					<svg
						viewBox="0 0 36 36"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						class="h-6 w-6"
					>
						<path
							d="M9 15.5c0-4.418 3.134-8 7-8h4c3.866 0 7 3.582 7 8 0 2.53-1.142 4.79-2.893 6.203-.42.343-.638.875-.582 1.42l.238 2.29c.132 1.264-1.23 2.105-2.265 1.373l-2.908-2.063a1.5 1.5 0 0 0-1.708 0l-2.907 2.063c-1.036.732-2.397-.109-2.265-1.373l.238-2.29c.056-.545-.162-1.077-.582-1.42C10.142 20.29 9 18.03 9 15.5Z"
						/>
					</svg>
				</span>
				<span
					class="flex flex-col text-[10px] font-semibold tracking-[0.26em] text-[var(--muted)] uppercase"
				>
					<span class="text-base font-semibold tracking-tight text-[var(--text)]">GoChat</span>
					<span class="font-medium text-[var(--muted)]">Community invite</span>
				</span>
			</a>
			<a
				class="inline-flex items-center gap-2 rounded-full border border-[var(--stroke)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
				href="/app"
			>
				<span>Open app</span>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
					<path
						d="M11.172 5H6a1 1 0 1 1 0-2h8a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V7.414l-6.293 6.293a1 1 0 0 1-1.414-1.414L11.172 5Z"
					/>
				</svg>
			</a>
		</div>
	</header>

	<main
		class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-12 lg:py-16"
	>
		<section
			class="panel relative flex flex-col gap-6 overflow-hidden border border-[var(--stroke)]/80 bg-[var(--panel-strong)]/80 p-6 shadow-[var(--shadow-1)] sm:p-8"
			aria-labelledby="guild-title"
		>
			<div
				class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_65%)]"
			></div>
			<span
				class="inline-flex items-center rounded-full border border-[var(--stroke)]/60 bg-[var(--panel)]/60 px-3 py-1 text-xs font-semibold tracking-[0.26em] text-[var(--muted)] uppercase"
			>
				Exclusive invite
			</span>
			<div class="space-y-3">
				<h1
					id="guild-title"
					class="text-3xl leading-tight font-semibold text-[var(--text)] sm:text-4xl"
				>
					{getDisplayName(invite)}
				</h1>
				<p class="max-w-xl text-sm leading-relaxed text-[var(--text-2)] sm:text-base">
					{getMemberDescription(invite)}
				</p>
			</div>

			{#if getInviteUnavailableMessage(inviteState)}
				<div
					class="flex gap-3 rounded-2xl border border-[var(--stroke)] bg-[var(--panel)]/80 p-4 text-sm text-[var(--muted)]"
					role="status"
				>
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]/10 text-[var(--danger)]"
						aria-hidden="true"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
							<path
								fill-rule="evenodd"
								d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.596c.75 1.335-.213 3.005-1.742 3.005H3.48c-1.53 0-2.493-1.67-1.743-3.005L8.257 3.1ZM11 14a1 1 0 1 0-2 0 1 1 0 0 0 2 0Zm-.25-6.75a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0v-4Z"
								clip-rule="evenodd"
							/>
						</svg>
					</span>
					<div class="space-y-1">
						<p class="text-sm font-semibold text-[var(--text)]">Invite unavailable</p>
						<p>{getInviteUnavailableMessage(inviteState)}</p>
					</div>
				</div>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<div
					class="flex items-start gap-3 rounded-xl border border-[var(--stroke)] bg-[var(--panel)]/70 p-4"
				>
					<span
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--stroke)]/60 bg-[var(--panel-strong)]/70 text-[var(--brand)]"
						aria-hidden="true"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							class="h-5 w-5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.314 0-6 2.015-6 4.5V20h12v-1.5c0-2.485-2.686-4.5-6-4.5Z"
							/>
						</svg>
					</span>
					<div class="space-y-1 text-sm">
						<p class="text-xs font-medium tracking-wide text-[var(--muted)] uppercase">
							Community size
						</p>
						<p class="font-semibold text-[var(--text)]">{getMemberCountLabel(invite)}</p>
					</div>
				</div>
				<div
					class="flex items-start gap-3 rounded-xl border border-[var(--stroke)] bg-[var(--panel)]/70 p-4"
				>
					<span
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--stroke)]/60 bg-[var(--panel-strong)]/70 text-[var(--brand)]"
						aria-hidden="true"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							class="h-5 w-5"
						>
							<rect x="4" y="5" width="16" height="15" rx="2" ry="2" />
							<path stroke-linecap="round" d="M16 3v4M8 3v4M4 10h16" />
						</svg>
					</span>
					<div class="space-y-1 text-sm">
						<p class="text-xs font-medium tracking-wide text-[var(--muted)] uppercase">Created</p>
						<p class="font-semibold text-[var(--text)]">{getCreatedLabel(invite)}</p>
					</div>
				</div>
				<div
					class="flex items-start gap-3 rounded-xl border border-[var(--stroke)] bg-[var(--panel)]/70 p-4"
				>
					<span
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--stroke)]/60 bg-[var(--panel-strong)]/70 text-[var(--brand)]"
						aria-hidden="true"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							class="h-5 w-5"
						>
							<circle cx="12" cy="12" r="9" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 3" />
						</svg>
					</span>
					<div class="space-y-1 text-sm">
						<p class="text-xs font-medium tracking-wide text-[var(--muted)] uppercase">
							Invite status
						</p>
						<div class="flex items-center gap-2 font-semibold text-[var(--text)]">
							<span>{getInviteStatusLabel(inviteState, invite)}</span>
							<span
								class="inline-flex items-center rounded-full border border-[var(--stroke)]/50 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
								style={`background: var(--${getStatusTone(inviteState, invite)}); color: var(--bg);`}
								aria-hidden="true"
							>
								{getInviteStatusLabel(inviteState, invite)}
							</span>
						</div>
						<p class="text-xs text-[var(--muted)]">
							{getInviteStatusDescriptor(inviteState, invite)}
						</p>
					</div>
				</div>
			</div>

			<div
				class="flex flex-col gap-4 rounded-2xl border border-[var(--stroke)] bg-[var(--panel-strong)]/80 p-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div>
					<span class="text-xs font-medium tracking-wide text-[var(--muted)] uppercase"
						>Invite code</span
					>
					<code
						class="mt-1 block font-mono text-lg tracking-[0.25em] text-[var(--text)] sm:text-xl"
						aria-label={`Invite code ${inviteCodeValue || 'unavailable'}`}
					>
						{inviteCodeValue || 'Unavailable'}
					</code>
				</div>
				<button
					class="inline-flex items-center gap-2 self-start rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--bg)] shadow-sm transition hover:bg-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					type="button"
					onclick={copyCode}
					disabled={!inviteCodeValue}
				>
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
						<path
							d="M4 4a2 2 0 0 1 2-2h5.5a2 2 0 0 1 2 2v2H15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2H6a2 2 0 0 1-2-2V4Zm7.5 2V4H6v7h1V8a2 2 0 0 1 2-2h2.5Z"
						/>
					</svg>
					<span
						>{copyStatus === 'copied'
							? 'Copied'
							: copyStatus === 'error'
								? 'Copy failed'
								: 'Copy code'}</span
					>
				</button>
			</div>
			<p class="min-h-[1.25rem] text-xs text-[var(--muted)]" aria-live="polite">
				{#if copyStatus === 'copied'}Invite code copied to clipboard.{:else if copyStatus === 'error'}Unable
					to copy the invite code.{/if}
			</p>

			<div class="flex flex-wrap items-center gap-3">
				<a
					class="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--bg)] shadow-sm transition hover:bg-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
					href="/app"
				>
					<span>Launch GoChat</span>
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
						<path
							d="M12.293 4.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1 0 1.414l-4 4a1 1 0 1 1-1.414-1.414L14.586 10H4a1 1 0 1 1 0-2h10.586l-2.293-2.293a1 1 0 0 1 0-1.414Z"
						/>
					</svg>
				</a>
				<a
					class="inline-flex items-center gap-2 rounded-full border border-[var(--stroke)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
					href="/"
				>
					<span>Discover GoChat</span>
				</a>
			</div>
			<p class="text-xs text-[var(--muted)]">Sign in or create an account to accept this invite.</p>
		</section>

		<section class="space-y-4" aria-label="Sign in or create an account">
			<h2 class="text-sm font-semibold tracking-wide text-[var(--muted)] uppercase">
				Access your account
			</h2>
			<div class="panel border border-[var(--stroke)] bg-[var(--panel)]/80 p-4 sm:p-6">
				<div class="invite-auth">
					<AuthGate>
						<div
							class="flex flex-col gap-4 rounded-2xl border border-[var(--stroke)] bg-[var(--panel-strong)]/80 p-6 text-left shadow-sm"
							role="status"
						>
							<span
								class="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--success)]/15 text-[var(--success)]"
								aria-hidden="true"
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									class="h-6 w-6"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 10.5 18 19 6" />
								</svg>
							</span>
							<h2 class="text-lg font-semibold text-[var(--text)]">You're already signed in</h2>
							<p class="text-sm leading-relaxed text-[var(--text-2)]">
								Launch the app to finish joining {invite?.guild?.name ?? 'this guild'}.
							</p>
							<a
								class="inline-flex items-center gap-2 self-start rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--bg)] shadow-sm transition hover:bg-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
								href="/app"
							>
								<span>Continue to GoChat</span>
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
									<path
										d="M12.293 4.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1 0 1.414l-4 4a1 1 0 1 1-1.414-1.414L14.586 10H4a1 1 0 1 1 0-2h10.586l-2.293-2.293a1 1 0 0 1 0-1.414Z"
									/>
								</svg>
							</a>
						</div>
					</AuthGate>
				</div>
			</div>
		</section>
	</main>
</div>

<style>
	:global(.invite-auth > div) {
		display: flex !important;
		width: 100% !important;
		height: auto !important;
		min-height: 0 !important;
		padding: 0 !important;
		justify-content: center;
	}

	:global(.invite-auth > div .panel) {
		width: 100%;
		max-width: 26rem;
	}
</style>
