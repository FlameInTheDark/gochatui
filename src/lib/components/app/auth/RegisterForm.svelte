<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { createEventDispatcher } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

        const dispatch = createEventDispatcher<{ sent: { email: string } }>();
        let email = $state('');
        let loading = $state(false);
        let error: string | null = $state(null);

        async function onSubmit() {
                const normalizedEmail = email.trim();
                email = normalizedEmail;
                loading = true;
                error = null;
                try {
                        await auth.register({ email: normalizedEmail });
                        dispatch('sent', { email: normalizedEmail });
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
