<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { createEventDispatcher } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	const dispatch = createEventDispatcher<{ success: void }>();
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error: string | null = $state(null);

	async function onSubmit() {
		loading = true;
		error = null;
		try {
			await auth.login({ email, password });
			dispatch('success');
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? m.auth_login_failed();
		} finally {
			loading = false;
		}
	}
</script>

<form
	class="space-y-3"
	on:submit={(e) => {
		e.preventDefault();
		onSubmit();
	}}
>
	<div class="text-lg font-semibold">{m.auth_sign_in_title()}</div>
	{#if error}<div class="text-sm text-red-500">{error}</div>{/if}
	<div class="space-y-1">
		<label for="login-email" class="text-sm text-[var(--muted)]">{m.auth_email()}</label>
		<input
			id="login-email"
			class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
			type="email"
			bind:value={email}
			required
			placeholder={m.auth_email_placeholder()}
		/>
	</div>
	<div class="space-y-1">
		<label for="login-password" class="text-sm text-[var(--muted)]">{m.auth_password()}</label>
		<input
			id="login-password"
			class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
			type="password"
			bind:value={password}
			required
		/>
	</div>
	<button
		class="w-full rounded-md bg-[var(--brand)] py-2 font-medium text-[var(--bg)] disabled:opacity-50"
		disabled={loading}
	>
		{loading ? m.auth_signing_in() : m.auth_sign_in()}
	</button>
</form>
