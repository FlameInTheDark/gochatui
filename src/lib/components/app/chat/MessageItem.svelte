<script lang="ts">
  import type { DtoMessage } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId } from '$lib/stores/appState';
  import { createEventDispatcher } from 'svelte';

  let { message } = $props<{ message: DtoMessage }>();
  let isEditing = false;
  let draft = message.content ?? '';
  let saving = false;
  const dispatch = createEventDispatcher<{ deleted: void }>();

  function fmtTime(s?: string) {
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
  }

  async function saveEdit() {
    if (!$selectedChannelId || !message.id) return;
    saving = true;
    try {
      await auth.api.message.messageChannelChannelIdMessageIdPatch({
        channelId: $selectedChannelId as any,
        messageId: message.id as any,
        messageUpdateMessageRequest: { content: draft }
      });
      message.content = draft;
      isEditing = false;
    } finally {
      saving = false;
    }
  }

  async function deleteMsg() {
    if (!$selectedChannelId || !message.id) return;
    await auth.api.message.messageChannelChannelIdMessageIdDelete({
      channelId: $selectedChannelId as any,
      messageId: message.id as any
    });
    // Let parent re-load
    dispatch('deleted');
  }
</script>

<div class="flex gap-3 px-4 py-2 hover:bg-[var(--panel)]/40 rounded">
  <div class="w-10 h-10 rounded-full bg-[var(--panel-strong)] border border-[var(--stroke)] grid place-items-center text-sm">
    {(message.author?.name ?? '?').slice(0, 2).toUpperCase()}
  </div>
  <div class="flex-1 min-w-0">
    <div class="flex items-baseline gap-2">
      <div class="font-semibold">{message.author?.name ?? 'User'}<span class="text-[var(--muted)]">{message.author?.discriminator ? ` · ${message.author?.discriminator}` : ''}</span></div>
      <div class="text-xs text-[var(--muted)]">{fmtTime(message.updated_at)}</div>
    </div>
    {#if isEditing}
      <div class="mt-1">
        <textarea class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" bind:value={draft} rows={3}></textarea>
        <div class="mt-1 flex gap-2 text-sm">
          <button class="px-2 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)]" disabled={saving} on:click={saveEdit}>{saving ? 'Saving…' : 'Save'}</button>
          <button class="px-2 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (isEditing = false)}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2">{message.content}</div>
      {#if message.attachments?.length}
        <div class="mt-2 flex flex-wrap gap-2">
          {#each message.attachments as a}
            <div class="px-2 py-1 rounded-md border border-[var(--stroke)] text-xs">
              {a.filename}
            </div>
          {/each}
        </div>
      {/if}
      <div class="mt-1 text-xs text-[var(--muted)] flex gap-3">
        <button class="underline" on:click={() => { isEditing = true; draft = message.content ?? '' }}>Edit</button>
        <button class="underline text-red-400" on:click={deleteMsg}>Delete</button>
      </div>
    {/if}
  </div>
</div>
