<script lang="ts">
  import { selectedChannelId, channelsByGuild, selectedGuildId } from '$lib/stores/appState';
  import MessageList from './MessageList.svelte';
  import MessageInput from './MessageInput.svelte';
  import { channelReady } from '$lib/stores/appState';
  let listRef: any = null;

  function currentChannel() {
    const gid = $selectedGuildId ?? '';
    return ($channelsByGuild[gid] ?? []).find((c) => String((c as any).id) === $selectedChannelId);
  }
  function channelName() {
    const ch = currentChannel();
    return ch?.name ?? 'Channel';
  }

  function channelTopic() {
    const ch = currentChannel() as any;
    const t = (ch?.topic ?? '').toString().trim();
    return t;
  }
</script>

<div class="flex flex-col h-full min-h-0">
  <div class="h-14 border-b border-[var(--stroke)] flex items-center px-4 font-semibold overflow-hidden">
    <div class="truncate"># {channelName()}</div>
    {#if channelTopic()}
      <div class="ml-2 text-sm font-normal text-[var(--muted)] truncate">— {channelTopic()}</div>
    {/if}
  </div>
  {#if $selectedChannelId && $channelReady && (currentChannel() as any)?.type === 0}
    <MessageList bind:this={listRef} />
    <MessageInput />
  {:else}
    <div class="flex-1 grid place-items-center text-[var(--muted)]">Select a text channel to start chatting.</div>
  {/if}
</div>
