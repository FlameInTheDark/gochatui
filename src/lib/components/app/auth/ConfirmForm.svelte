<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { createEventDispatcher } from 'svelte';
  import { m } from '$lib/paraglide/messages.js';

  const dispatch = createEventDispatcher<{ success: void }>();
  let id: number | null = null;
  let token = '';
  let name = '';
  let discriminator = '';
  let password = '';
  let loading = false;
  let error: string | null = null;

  async function onSubmit() {
    loading = true; error = null;
    try {
      await auth.confirm({ id: id ?? undefined, token, name, discriminator, password });
      dispatch('success');
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? m.auth_confirmation_failed();
    } finally {
      loading = false;
    }
  }
</script>

<form class="space-y-3" on:submit|preventDefault={onSubmit}>
  <div class="text-lg font-semibold">{m.auth_confirm_account()}</div>
  {#if error}<div class="text-red-500 text-sm">{error}</div>{/if}
  <div class="grid grid-cols-2 gap-2">
    <div class="space-y-1">
      <label class="text-sm text-[var(--muted)]">{m.auth_user_id()}</label>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="number" bind:value={id} required />
    </div>
    <div class="space-y-1">
      <label class="text-sm text-[var(--muted)]">{m.auth_token()}</label>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="text" bind:value={token} required />
    </div>
  </div>
  <div class="grid grid-cols-2 gap-2">
    <div class="space-y-1">
      <label class="text-sm text-[var(--muted)]">{m.auth_name()}</label>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="text" bind:value={name} required />
    </div>
    <div class="space-y-1">
      <label class="text-sm text-[var(--muted)]">{m.auth_discriminator()}</label>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="text" bind:value={discriminator} required />
    </div>
  </div>
  <div class="space-y-1">
    <label class="text-sm text-[var(--muted)]">{m.auth_password()}</label>
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="password" bind:value={password} required />
  </div>
  <button class="w-full rounded-md bg-[var(--brand)] text-[var(--bg)] py-2 font-medium disabled:opacity-50" disabled={loading}>
    {loading ? m.auth_confirming() : m.auth_confirm()}
  </button>
</form>

