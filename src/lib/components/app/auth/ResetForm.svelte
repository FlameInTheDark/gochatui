<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages.js';

	type ResetDefaults = {
		id?: string;
		token?: string;
	};

	let { defaults } = $props<{ defaults?: ResetDefaults }>();

	let id = $state(defaults?.id ?? '');
	let token = $state(defaults?.token ?? '');
	let password = $state('');
	let loading = $state(false);
	let message: string | null = $state(null);
	let error: string | null = $state(null);
	let hideCredentials = $state(Boolean(defaults?.id && defaults?.token));

	$effect(() => {
		if (!defaults) return;
		if (defaults.id !== undefined) id = defaults.id;
		if (defaults.token !== undefined) token = defaults.token;
		hideCredentials = Boolean(defaults.id && defaults.token);
	});

	async function onSubmit() {
		loading = true;
		error = null;
		message = null;
		const trimmedId = id.trim();
		const trimmedToken = token.trim();
		if (!trimmedId || !trimmedToken) {
			error = m.auth_reset_failed();
			loading = false;
			return;
		}

		let parsedId: bigint;
		try {
			parsedId = BigInt(trimmedId);
		} catch {
			error = m.auth_reset_failed();
			loading = false;
			return;
		}
		try {
			await auth.reset({ id: parsedId as any, token: trimmedToken, password });
			message = m.auth_reset_success();
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? m.auth_reset_failed();
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
	<div class="text-lg font-semibold">{m.auth_reset_password()}</div>
	{#if message}<div class="text-sm text-green-500">{message}</div>{/if}
	{#if error}<div class="text-sm text-red-500">{error}</div>{/if}
	{#if !hideCredentials}
		<div class="grid grid-cols-2 gap-2">
			<div class="space-y-1">
				<label for="reset-id" class="text-sm text-[var(--muted)]">{m.auth_user_id()}</label>
				<input
					id="reset-id"
					class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					type="text"
					inputmode="numeric"
					pattern="\\d*"
					bind:value={id}
					required
				/>
			</div>
			<div class="space-y-1">
				<label for="reset-token" class="text-sm text-[var(--muted)]">{m.auth_token()}</label>
				<input
					id="reset-token"
					class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					type="text"
					bind:value={token}
					required
				/>
			</div>
		</div>
	{/if}
	<div class="space-y-1">
		<label for="reset-password" class="text-sm text-[var(--muted)]">{m.auth_new_password()}</label>
		<input
			id="reset-password"
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
		{loading ? m.auth_reseting() : m.auth_reset_password_btn()}
	</button>
</form>
