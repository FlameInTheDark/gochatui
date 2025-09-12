<script lang="ts">
  import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
  import ServerBar from '$lib/components/app/sidebar/ServerBar.svelte';
  import ChannelPane from '$lib/components/app/sidebar/ChannelPane.svelte';
  import ChatPane from '$lib/components/app/chat/ChatPane.svelte';
  import SearchPanel from '$lib/components/app/search/SearchPanel.svelte';
  import DmCreate from '$lib/components/app/dm/DmCreate.svelte';
  import ProfileEdit from '$lib/components/app/user/ProfileEdit.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import { searchOpen, selectedChannelId } from '$lib/stores/appState';
  import '$lib/client/ws';
  import { setLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages.js';

  let showProfile = false;
  let theme = $state<string>((typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'dark');
  $effect(() => { if (typeof document !== 'undefined') { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('theme', theme); } catch {} } });
  function toggleTheme() { theme = theme === 'dark' ? 'light' : 'dark'; }
</script>

<AuthGate>
  <div class="h-screen w-screen grid" style="grid-template-columns: var(--col1) var(--col2) 1fr;">
    <ServerBar />
    <div class="flex flex-col">
      <div class="h-[var(--header-h)] flex-shrink-0 border-b border-[var(--stroke)] flex items-center justify-between px-3 box-border overflow-hidden">
          <div class="flex items-center gap-2">
            <DmCreate />
          </div>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1">
              <button class="px-2 h-8 rounded-md border border-[var(--stroke)] text-xs" on:click={() => setLocale('en')} title="English" aria-label="English">EN</button>
              <button class="px-2 h-8 rounded-md border border-[var(--stroke)] text-xs" on:click={() => setLocale('ru')} title="Русский" aria-label="Русский">RU</button>
            </div>
            <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]" on:click={toggleTheme} title={m.toggle_theme()} aria-label={m.toggle_theme()}>
              {#if theme === 'dark'}
                <!-- Sun icon -->
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zm10.48 0l1.8-1.79 1.41 1.41-1.79 1.8-1.42-1.42zM12 4h0-1 1V2h0zm0 18h0-1 1v-2h0zM4 13H2v-2h2v2zm18 0h-2v-2h2v2zM6.76 19.16l-1.8 1.79-1.41-1.41 1.79-1.8 1.42 1.42zm10.48 0l1.8 1.79 1.41-1.41-1.79-1.8-1.42 1.42zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>
              {:else}
                <!-- Moon icon -->
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              {/if}
            </button>
            <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]" on:click={() => (showProfile = !showProfile)} title={m.profile()} aria-label={m.profile()}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z"/><path d="M4 20a8 8 0 0 1 16 0v1H4v-1z"/></svg>
            </button>
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
  <ContextMenu />
</AuthGate>

<svelte:window on:keydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchOpen.set(true); } }} />
