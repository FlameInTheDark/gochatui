<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
	import ServerBar from '$lib/components/app/sidebar/ServerBar.svelte';
	import ChannelPane from '$lib/components/app/sidebar/ChannelPane.svelte';
	import ChatPane from '$lib/components/app/chat/ChatPane.svelte';
        import SearchPanel from '$lib/components/app/search/SearchPanel.svelte';
        import MemberProfilePanel from '$lib/components/app/chat/MemberProfilePanel.svelte';
	import DmCreate from '$lib/components/app/dm/DmCreate.svelte';
        import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
        import ConnectionStatusBar from '$lib/components/app/ConnectionStatusBar.svelte';
	import { appHasFocus, searchOpen } from '$lib/stores/appState';
        import '$lib/client/ws';
        import '$lib/stores/presence';
        import '$lib/stores/settingsSync';

	const updateAppFocus = () => {
		if (!browser) return;
		appHasFocus.set(document.visibilityState === 'visible' && document.hasFocus());
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			searchOpen.set(true);
		}
	};

	onMount(() => {
		updateAppFocus();
	});
</script>

<AuthGate>
	<div class="grid h-screen w-screen" style="grid-template-columns: var(--col1) var(--col2) 1fr;">
		<ServerBar />
		<div class="flex h-full min-h-0 flex-col overflow-hidden">
			<div
				class="box-border flex h-[var(--header-h)] flex-shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--stroke)] px-3"
			>
				<div class="flex items-center gap-2">
					<DmCreate />
				</div>
			</div>
			<ChannelPane />
		</div>
		<ChatPane />
                <SearchPanel />
                <MemberProfilePanel />
	</div>
        <ContextMenu />
        <ConnectionStatusBar />
</AuthGate>

<svelte:window
	on:focus={updateAppFocus}
	on:blur={updateAppFocus}
	on:visibilitychange={updateAppFocus}
	on:keydown={handleKeyDown}
/>
