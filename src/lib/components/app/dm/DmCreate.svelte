<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId, selectedGuildId } from '$lib/stores/appState';
  import { subscribeWS } from '$lib/client/ws';
  let open = false;
  let singleId: string = '';
  let groupIds = '';
  let error: string | null = null;
  let loading = false;

  async function createSingle() {
    if (!singleId) return;
    loading = true; error = null;
    try {
      const res = await auth.api.user.userMeChannelsPost({ userCreateDMRequest: { recipient_id: singleId as any } });
      const ch: any = res.data;
      if (ch?.id) {
        const id = String(ch.id);
        selectedChannelId.set(id);
        const gid = $selectedGuildId; // may be null for DM
        subscribeWS(gid ? [gid] : [], id);
      }
      open = false; singleId = '';
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to create DM';
    } finally { loading = false; }
  }

  async function createGroup() {
    const ids = groupIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    loading = true; error = null;
    try {
      const res = await auth.api.user.userMeChannelsGroupPost({ userCreateDMManyRequest: { recipients_id: ids as any } });
      const ch: any = res.data;
      if (ch?.id) {
        const id = String(ch.id);
        selectedChannelId.set(id);
        const gid = $selectedGuildId;
        subscribeWS(gid ? [gid] : [], id);
      }
      open = false; groupIds = '';
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to create group DM';
    } finally { loading = false; }
  }
</script>

<div>
  <button class="px-2 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (open = true)}>New DM</button>
  {#if open}
    <div class="fixed inset-0 bg-black/40 grid place-items-center z-40" on:click={() => (open = false)}>
      <div class="panel w-full max-w-md p-4" on:click|stopPropagation>
        <div class="text-sm font-medium mb-2">Create DM</div>
        {#if error}<div class="text-red-500 text-sm mb-2">{error}</div>{/if}
        <div class="space-y-2">
          <div>
            <div class="text-xs text-[var(--muted)] mb-1">Recipient user ID</div>
            <input type="number" class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" bind:value={singleId} />
            <div class="mt-2 flex justify-end">
              <button class="px-3 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50" disabled={loading} on:click={createSingle}>Create DM</button>
            </div>
          </div>
          <div class="border-t border-[var(--stroke)] pt-2">
            <div class="text-xs text-[var(--muted)] mb-1">Group recipients (comma-separated user IDs)</div>
            <input type="text" class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" bind:value={groupIds} />
            <div class="mt-2 flex justify-end">
              <button class="px-3 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50" disabled={loading} on:click={createGroup}>Create Group DM</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
