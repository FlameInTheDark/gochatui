<script lang="ts">
  import { auth } from '$lib/stores/auth';
  let id: number | null = null;
  let token = '';
  let password = '';
  let loading = false;
  let message: string | null = null;
  let error: string | null = null;

  async function onSubmit() {
    loading = true; error = null; message = null;
    try {
      await auth.reset({ id: id ?? undefined, token, password });
      message = 'Password reset successful. You can sign in now.';
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Password reset failed';
    } finally {
      loading = false;
    }
  }
</script>

<form class="space-y-3" on:submit|preventDefault={onSubmit}>
  <div class="text-lg font-semibold">Reset password</div>
  {#if message}<div class="text-green-500 text-sm">{message}</div>{/if}
  {#if error}<div class="text-red-500 text-sm">{error}</div>{/if}
  <div class="grid grid-cols-2 gap-2">
    <div class="space-y-1">
      <label class="text-sm text-[var(--muted)]">User ID</label>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="number" bind:value={id} required />
    </div>
    <div class="space-y-1">
      <label class="text-sm text-[var(--muted)]">Token</label>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="text" bind:value={token} required />
    </div>
  </div>
  <div class="space-y-1">
    <label class="text-sm text-[var(--muted)]">New password</label>
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="password" bind:value={password} required />
  </div>
  <button class="w-full rounded-md bg-[var(--brand)] text-[var(--bg)] py-2 font-medium disabled:opacity-50" disabled={loading}>
    {loading ? 'Resetting…' : 'Reset password'}
  </button>
</form>

