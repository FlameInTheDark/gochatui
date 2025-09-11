<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{ success: void }>();
  let email = '';
  let password = '';
  let loading = false;
  let error: string | null = null;

  async function onSubmit() {
    loading = true; error = null;
    try {
      await auth.login({ email, password });
      dispatch('success');
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<form class="space-y-3" on:submit|preventDefault={onSubmit}>
  <div class="text-lg font-semibold">Sign in</div>
  {#if error}<div class="text-red-500 text-sm">{error}</div>{/if}
  <div class="space-y-1">
    <label class="text-sm text-[var(--muted)]">Email</label>
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="email" bind:value={email} required placeholder="you@example.com" />
  </div>
  <div class="space-y-1">
    <label class="text-sm text-[var(--muted)]">Password</label>
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="password" bind:value={password} required />
  </div>
  <button class="w-full rounded-md bg-[var(--brand)] text-[var(--bg)] py-2 font-medium disabled:opacity-50" disabled={loading}>
    {loading ? 'Signing in…' : 'Sign in'}
  </button>
</form>

