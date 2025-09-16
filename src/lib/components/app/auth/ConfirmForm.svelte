<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { createEventDispatcher } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	const dispatch = createEventDispatcher<{ success: void }>();
        let id = $state('');
	let token = $state('');
	let name = $state('');
	let discriminator = $state('');
	let password = $state('');
	let loading = $state(false);
	let error: string | null = $state(null);

	async function onSubmit() {
		loading = true;
		error = null;
                let parsedId: bigint | undefined;
                try {
                        parsedId = id.trim() ? BigInt(id.trim()) : undefined;
                } catch {
                        error = m.auth_confirmation_failed();
                        loading = false;
                        return;
                }

                try {
                        await auth.confirm({
                                id: parsedId,
                                token,
                                name,
                                discriminator,
                                password
                        });
                        dispatch('success');
                } catch (e: any) {
                        error = e?.response?.data?.message ?? e?.message ?? m.auth_confirmation_failed();
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
	<div class="text-lg font-semibold">{m.auth_confirm_account()}</div>
	{#if error}<div class="text-sm text-red-500">{error}</div>{/if}
	<div class="grid grid-cols-2 gap-2">
		<div class="space-y-1">
			<label for="confirm-id" class="text-sm text-[var(--muted)]">{m.auth_user_id()}</label>
			<input
				id="confirm-id"
				class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
                                type="text"
                                inputmode="numeric"
                                pattern="\\d*"
                                bind:value={id}
                                required
                        />
		</div>
		<div class="space-y-1">
			<label for="confirm-token" class="text-sm text-[var(--muted)]">{m.auth_token()}</label>
			<input
				id="confirm-token"
				class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
				type="text"
				bind:value={token}
				required
			/>
		</div>
	</div>
	<div class="grid grid-cols-2 gap-2">
		<div class="space-y-1">
			<label for="confirm-name" class="text-sm text-[var(--muted)]">{m.auth_name()}</label>
			<input
				id="confirm-name"
				class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
				type="text"
				bind:value={name}
				required
			/>
		</div>
		<div class="space-y-1">
			<label for="confirm-disc" class="text-sm text-[var(--muted)]">{m.auth_discriminator()}</label>
			<input
				id="confirm-disc"
				class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
				type="text"
				bind:value={discriminator}
				required
			/>
		</div>
	</div>
	<div class="space-y-1">
		<label for="confirm-password" class="text-sm text-[var(--muted)]">{m.auth_password()}</label>
		<input
			id="confirm-password"
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
		{loading ? m.auth_confirming() : m.auth_confirm()}
	</button>
</form>
