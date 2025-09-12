<script lang="ts">
	import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
	import ServerBar from '$lib/components/app/sidebar/ServerBar.svelte';
	import ChannelPane from '$lib/components/app/sidebar/ChannelPane.svelte';
	import ChatPane from '$lib/components/app/chat/ChatPane.svelte';
	import SearchPanel from '$lib/components/app/search/SearchPanel.svelte';
	import DmCreate from '$lib/components/app/dm/DmCreate.svelte';
	import ProfileEdit from '$lib/components/app/user/ProfileEdit.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import { searchOpen } from '$lib/stores/appState';
	import '$lib/client/ws';
	import { m } from '$lib/paraglide/messages.js';

	let showProfile = false;
</script>

<AuthGate>
	<div class="grid h-screen w-screen" style="grid-template-columns: var(--col1) var(--col2) 1fr;">
		<ServerBar />
		<div class="flex flex-col">
			<div
				class="box-border flex h-[var(--header-h)] flex-shrink-0 items-center justify-between overflow-hidden border-b border-[var(--stroke)] px-3"
			>
				<div class="flex items-center gap-2">
					<DmCreate />
				</div>
				<div class="flex items-center gap-2">
					<button
						class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
						on:click={() => (showProfile = !showProfile)}
						title={m.profile()}
						aria-label={m.profile()}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							width="16"
							height="16"
							fill="currentColor"
							><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" /><path
								d="M4 20a8 8 0 0 1 16 0v1H4v-1z"
							/></svg
						>
					</button>
				</div>
			</div>
			<ChannelPane />
		</div>
		<ChatPane />
		<SearchPanel />
		{#if showProfile}
			<div class="fixed top-20 right-4 z-40">
				<ProfileEdit />
			</div>
		{/if}
	</div>
	<ContextMenu />
</AuthGate>

<svelte:window
	on:keydown={(e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			searchOpen.set(true);
		}
	}}
/>
