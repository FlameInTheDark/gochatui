<script lang="ts">
  import type { DtoMessage } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId } from '$lib/stores/appState';
  import { createEventDispatcher } from 'svelte';
  import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';

  let { message, compact = false } = $props<{ message: DtoMessage; compact?: boolean }>();
  let isEditing = false;
  let draft = message.content ?? '';
  let Saving… false;
  const dispatch = createEventDispatcher<{ deleted: void }>();

  const EPOCH_MS = Date.UTC(2008, 10, 10, 23, 0, 0, 0); // 2008-11-10T23:00:00Z

  function snowflakeToDate(id: any): Date | null {
    if (id == null) return null;
    try {
      const s = String(id).replace(/[^0-9]/g, '');
      if (!s) return null;
      const v = BigInt(s);
      const ms = Number(v >> 22n);
      return new Date(EPOCH_MS + ms);
    } catch {
      return null;
    }
  }

  function fmtMsgTime(m: DtoMessage) {
    const d = snowflakeToDate((m as any).id) || (m.updated_at ? new Date(m.updated_at) : null);
    if (!d || Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
  }

  function fmtMsgFull(m: DtoMessage) {
    const d = snowflakeToDate((m as any).id) || (m.updated_at ? new Date(m.updated_at) : null);
    if (!d || Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  }

  async function saveEdit() {
    if (!$selectedChannelId || !message.id) return;
    Saving… true;
    try {
      await auth.api.message.messageChannelChannelIdMessageIdPatch({
        channelId: $selectedChannelId as any,
        messageId: message.id as any,
        messageUpdateMessageRequest: { content: draft }
      });
      message.content = draft;
      isEditing = false;
    } finally {
      Saving… false;
    }
  }

  async function deleteMsg() {
    if (!$selectedChannelId || !message.id) return;
    await auth.api.message.messageChannelChannelIdMessageIdDelete({
      channelId: $selectedChannelId as any,
      messageId: message.id as any
    });
    dispatch('deleted');
  }

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    const mid = String((message as any)?.id ?? '');
    const uid = String(((message as any)?.author as any)?.id ?? '');
    const items = [
      { label: 'Copy message ID', action: () => copyToClipboard(mid), disabled: !mid },
      { label: 'Copy user ID', action: () => copyToClipboard(uid), disabled: !uid },
      { label: 'Edit message', action: () => { isEditing = true; draft = message.content ?? ''; }, disabled: !message?.id },
      { label: 'Delete message', action: () => deleteMsg(), danger: true, disabled: !message?.id }
    ];
    contextMenu.openFromEvent(e, items);
  }
</script>

<div class={`group/message flex gap-3 px-4 ${compact ? 'py-0.5' : 'py-2'} hover:bg-[var(--panel)]/30`} on:contextmenu={openMenu}>
  {#if compact}
    <div class="w-10 shrink-0 pr-1 text-[10px] text-[var(--muted)] leading-tight pt-0.5 text-right opacity-0 group-hover/message:opacity-100 transition-opacity" title={fmtMsgFull(message)}>
      {fmtMsgTime(message)}
    </div>
  {:else}
    <div class="w-10 h-10 shrink-0 rounded-full bg-[var(--panel-strong)] border border-[var(--stroke)] grid place-items-center text-sm">
      {(message.author?.name ?? '?').slice(0, 2).toUpperCase()}
    </div>
  {/if}
  <div class="flex-1 min-w-0 relative">
    {#if !isEditing}
      <div class="absolute right-2 top-1 opacity-0 group-hover/message:opacity-100 transition-opacity flex items-center gap-1">
        <button class="p-1 rounded border border-[var(--stroke)] hover:bg-[var(--panel)]" title="Edit" aria-label="Edit" on:click={() => { isEditing = true; draft = message.content ?? '' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="p-1 rounded border border-[var(--stroke)] text-red-400 hover:bg-[var(--panel)]" title="Delete" aria-label="Delete" on:click={deleteMsg}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 7h12v2H6z"/><path d="M8 9h8l-1 11H9L8 9z"/><path d="M10 4h4v2h-4z"/></svg>
        </button>
      </div>
    {/if}

    {#if !compact}
      <div class="flex items-baseline gap-2 pr-20">
        <div class="font-semibold truncate" on:contextmenu|preventDefault={(e)=>{
          const uid = String(((message as any)?.author as any)?.id ?? '');
          contextMenu.openFromEvent(e,[
            { label: 'Copy user ID', action: () => copyToClipboard(uid), disabled: !uid }
          ]);
        }}>{message.author?.name ?? 'User'}</div>
        <div class="text-xs text-[var(--muted)]" title={fmtMsgFull(message)}>{fmtMsgTime(message)}</div>
      </div>
    {/if}

    {#if isEditing}
      <div class="mt-1">
        <textarea class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" bind:value={draft} rows={3}></textarea>
        <div class="mt-1 flex gap-2 text-sm">
          <button class="px-2 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)]" disabled={Saving…on:click={saveEdit}>{Saving… 'Saving…¦' : 'Save'}</button>
          <button class="px-2 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (isEditing = false)}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class={compact ? 'mt-0 whitespace-pre-wrap leading-tight text-sm pr-16' : 'mt-0.5 whitespace-pre-wrap pr-16'} title={fmtMsgFull(message)}>{message.content}</div>
      {#if message.attachments?.length}
        <div class={compact ? 'mt-1 flex flex-wrap gap-2' : 'mt-1.5 flex flex-wrap gap-2'}>
          {#each message.attachments as a}
            <div class="px-2 py-0.5 rounded border border-[var(--stroke)] text-xs bg-[var(--panel)]">
              {a.filename}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>
