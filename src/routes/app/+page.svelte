<script lang="ts">
  import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
  import ServerBar from '$lib/components/app/sidebar/ServerBar.svelte';
  import ChannelPane from '$lib/components/app/sidebar/ChannelPane.svelte';
  import ChatPane from '$lib/components/app/chat/ChatPane.svelte';
  import SearchPanel from '$lib/components/app/search/SearchPanel.svelte';
  import DmCreate from '$lib/components/app/dm/DmCreate.svelte';
  import ProfileEdit from '$lib/components/app/user/ProfileEdit.svelte';
  import { searchOpen, selectedChannelId } from '$lib/stores/appState';
  import '$lib/client/ws';

  let showProfile = false;
  let theme = $state<string>((typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'dark');
  $effect(() => { if (typeof document !== 'undefined') { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('theme', theme); } catch {} } });
  function toggleTheme() { theme = theme === 'dark' ? 'light' : 'dark'; }
</script>

<AuthGate>
  <div class="h-screen w-screen grid" style="grid-template-columns: var(--col1) var(--col2) 1fr;">
    <ServerBar />
    <div class="flex flex-col">
      <div class="h-14 border-b border-[var(--stroke)] flex items-center justify-between px-3">
          <div class="flex items-center gap-2">
            <DmCreate />
          </div>
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 rounded-md border border-[var(--stroke)]" on:click={() => searchOpen.set(true)}>Search</button>
            <button class="px-2 py-1 rounded-md border border-[var(--stroke)]" on:click={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
            <button class="px-2 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (showProfile = !showProfile)}>Profile</button>
          </div>
        </div>
      <ChannelPane />
    </div>
    <ChatPane />
    <SearchPanel />
    {#if showProfile}
      <div class="fixed right-4 top-20 z-40">
        <ProfileEdit />
      </div>
    {/if}
  </div>
</AuthGate>

<svelte:window on:keydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchOpen.set(true); } }} />
