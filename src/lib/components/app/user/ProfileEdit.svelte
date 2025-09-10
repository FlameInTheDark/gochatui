<script lang="ts">
  import { auth } from '$lib/stores/auth';
  let name = '';
  let loading = false;
  let message: string | null = null;

  async function save() {
    loading = true; message = null;
    try {
      await auth.api.user.mePatch({ userModifyUserRequest: { name } });
      message = 'Profile updated';
    } finally {
      loading = false;
    }
  }
</script>

<div class="panel p-3 space-y-2">
  <div class="text-sm font-medium">Profile</div>
  <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" placeholder="Display name" bind:value={name} />
  <div class="flex justify-end gap-2">
    <button class="px-3 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50" disabled={loading} on:click={save}>Save</button>
  </div>
  {#if message}<div class="text-xs text-green-500">{message}</div>{/if}
  <div class="text-xs text-[var(--muted)]">Use logout/login if not reflected immediately.</div>
  <button class="mt-2 text-sm underline text-red-400" on:click={() => auth.logout()}>Logout</button>
  
</div>
