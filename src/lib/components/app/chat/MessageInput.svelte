<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId } from '$lib/stores/appState';
  import AttachmentUploader from './AttachmentUploader.svelte';
  import { createEventDispatcher } from 'svelte';

  let content = '';
  let attachments: number[] = [];
  let sending = false;
  const dispatch = createEventDispatcher<{ sent: void }>();

  async function send() {
    if (!$selectedChannelId || (!content.trim() && attachments.length === 0)) return;
    sending = true;
    try {
      await auth.api.message.messageChannelChannelIdPost({
        channelId: $selectedChannelId as any,
        messageSendMessageRequest: {
          content: content.trim(),
          attachments: attachments as any
        }
      });
      content = '';
      attachments = [];
      dispatch('sent');
    } finally {
      sending = false;
    }
  }
</script>

<div class="border-t border-[var(--stroke)] p-3 flex items-center gap-2">
  <AttachmentUploader {attachments} />
  <textarea
    class="flex-1 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
    rows={2}
    placeholder="Message #channel"
    bind:value={content}
    on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
  ></textarea>
  <button class="px-4 py-2 rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50" disabled={sending} on:click={send}>Send</button>
  {#if attachments.length}
    <div class="text-xs text-[var(--muted)]">+{attachments.length}</div>
  {/if}
</div>
