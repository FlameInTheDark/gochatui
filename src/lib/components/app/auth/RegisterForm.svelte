<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { createEventDispatcher } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	const dispatch = createEventDispatcher<{ sent: void }>();
	let email = $state('');
	let loading = $state(false);
	let message: string | null = $state(null);
	let error: string | null = $state(null);

	async function onSubmit() {
		loading = true;
		error = null;
		message = null;
		try {
			await auth.register({ email });
			message = m.auth_confirmation_sent();
			dispatch('sent');
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? m.auth_registration_failed();
		} finally {
			loading = false;
		}
	}
</script>

<form
	class="space-y-3"
	onsubmit={(e) => {
		e.preventDefault();
		onSubmit();
	}}
>
	<div class="text-lg font-semibold">{m.auth_create_account()}</div>
	{#if message}<div class="text-sm text-green-500">{message}</div>{/if}
	{#if error}<div class="text-sm text-red-500">{error}</div>{/if}
	<div class="space-y-1">
		<label for="register-email" class="text-sm text-[var(--muted)]">{m.auth_email()}</label>
		<input
			id="register-email"
			class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
			type="email"
			bind:value={email}
			required
			placeholder={m.auth_email_placeholder()}
		/>
	</div>
	<button
		class="w-full rounded-md bg-[var(--brand)] py-2 font-medium text-[var(--bg)] disabled:opacity-50"
		disabled={loading}
	>
		{loading ? m.auth_sending() : m.auth_register()}
	</button>
</form>
