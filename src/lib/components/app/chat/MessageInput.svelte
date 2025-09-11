<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId } from '$lib/stores/appState';
  import AttachmentUploader from './AttachmentUploader.svelte';
  import { createEventDispatcher, onMount, tick } from 'svelte';

  let content = '';
  let attachments: number[] = [];
  let sending = false;
  const dispatch = createEventDispatcher<{ sent: void }>();

  let ta: HTMLTextAreaElement | null = null;

  function autoResize() {
    if (!ta) return;
    ta.style.height = 'auto';
    const max = Math.floor((window?.innerHeight || 800) * 0.4);
    const next = Math.min(ta.scrollHeight, max);
    ta.style.height = next + 'px';
    ta.style.overflowY = ta.scrollHeight > next ? 'auto' : 'hidden';
  }

  onMount(() => {
    autoResize();
  });

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
      // wait for DOM to reflect cleared content, then collapse height
      await tick();
      if (ta) {
        ta.style.height = 'auto';
        ta.style.overflowY = 'hidden';
      }
      attachments = [];
      dispatch('sent');
    } finally {
      sending = false;
    }
  }
</script>

<div class="border-t border-[var(--stroke)] p-3">
  <div class="chat-input rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-2 py-1 flex items-end gap-2 focus-within:outline-none focus-within:ring-0 focus-within:ring-offset-0 focus-within:shadow-none focus-within:border-[var(--stroke)]">
    <AttachmentUploader {attachments} inline on:updated={() => { attachments = [...attachments]; }} />
    <textarea
      bind:this={ta}
      class="flex-1 resize-none bg-transparent appearance-none border-0 focus:border-0 focus:border-transparent outline-none focus:outline-none ring-0 focus:ring-0 focus:ring-offset-0 focus:ring-transparent shadow-none focus:shadow-none px-1 py-1 min-h-[2.25rem] max-h-[40vh]"
      rows={1}
      placeholder="Message #channel"
      bind:value={content}
      on:input={autoResize}
      on:keydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      }}
    ></textarea>
    {#if attachments.length}
      <div class="text-xs text-[var(--muted)]">+{attachments.length}</div>
    {/if}
    <button class="w-9 h-9 rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50 grid place-items-center" disabled={sending} on:click={send} title="Send" aria-label="Send">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
    </button>
  </div>
</div>
