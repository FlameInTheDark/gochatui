<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { m } from '$lib/paraglide/messages.js';
  let email = '';
  let loading = false;
  let message: string | null = null;
  let error: string | null = null;

  async function onSubmit() {
    loading = true; error = null; message = null;
    try {
      await auth.recover({ email });
      message = m.auth_recovery_email_sent();
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? m.auth_recovery_failed();
    } finally {
      loading = false;
    }
  }
</script>

<form class="space-y-3" on:submit|preventDefault={onSubmit}>
  <div class="text-lg font-semibold">{m.auth_password_recovery()}</div>
  {#if message}<div class="text-green-500 text-sm">{message}</div>{/if}
  {#if error}<div class="text-red-500 text-sm">{error}</div>{/if}
  <div class="space-y-1">
    <label class="text-sm text-[var(--muted)]">{m.auth_email()}</label>
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" type="email" bind:value={email} required />
  </div>
  <button class="w-full rounded-md bg-[var(--brand)] text-[var(--bg)] py-2 font-medium disabled:opacity-50" disabled={loading}>
    {loading ? m.auth_sending() : m.auth_send_recovery_email()}
  </button>
</form>

