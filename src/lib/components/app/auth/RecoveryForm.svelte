<script lang="ts">
  import { auth } from '$lib/stores/auth';
  let email = '';
  let loading = false;
  let message: string | null = null;
  let error: string | null = null;

  async function onSubmit() {
    loading = true; error = null; message = null;
    try {
      await auth.recover({ email });
      message = 'Recovery email sent.';
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Recovery request failed';
    } finally {
      loading = false;
    }
  }
</script>

<form class="space-y-3" on:submit|preventDefault={onSubmit}>
  <div class="text-lg font-semibold">Password recovery</div>
  {#if message}<div class="text-green-500 text-sm">{message}</div>{/if}
  {#if error}<div class="text-red-500 text-sm">{error}</div>{/if}
  <div class="space-y-1">
    <label class="text-sm text-[var(--muted)]">Email</label>
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="email" bind:value={email} required />
  </div>
  <button class="w-full rounded-md bg-[var(--brand)] text-[var(--bg)] py-2 font-medium disabled:opacity-50" disabled={loading}>
    {loading ? 'Sending…' : 'Send recovery email'}
  </button>
</form>

