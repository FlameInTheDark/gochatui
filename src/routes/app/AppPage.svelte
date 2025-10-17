<script lang="ts">
        import { onMount } from 'svelte';
        import { browser } from '$app/environment';
        import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
        import ServerBar from '$lib/components/app/sidebar/ServerBar.svelte';
        import ChannelPane, { type ChannelPaneHandle } from '$lib/components/app/sidebar/ChannelPane.svelte';
        import ChatPane from '$lib/components/app/chat/ChatPane.svelte';
        import SearchPanel from '$lib/components/app/search/SearchPanel.svelte';
        import MemberProfilePanel from '$lib/components/app/chat/MemberProfilePanel.svelte';
        import UserScreen from '$lib/components/app/user/UserScreen.svelte';
        import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
        import ConnectionStatusBar from '$lib/components/app/ConnectionStatusBar.svelte';
        import { activeView, appHasFocus, searchOpen, selectedGuildId, guildSettingsOpen } from '$lib/stores/appState';
        import { auth } from '$lib/stores/auth';
        import { m } from '$lib/paraglide/messages.js';
        import { Plus, FolderPlus, Settings } from 'lucide-svelte';
        import {
                PERMISSION_MANAGE_CHANNELS,
                PERMISSION_MANAGE_GUILD,
                PERMISSION_MANAGE_ROLES,
                hasAnyGuildPermission
        } from '$lib/utils/permissions';
        import '$lib/client/ws';
        import '$lib/stores/presence';
        import '$lib/stores/settingsSync';

        const guilds = auth.guilds;
        const me = auth.user;

        const canAccessSelectedGuildSettings = $derived.by(() => {
                const gid = $selectedGuildId;
                if (!gid) return false;
                const guild = $guilds.find((g) => String((g as any)?.id) === gid) ?? null;
                return hasAnyGuildPermission(
                        guild,
                        $me?.id,
                        PERMISSION_MANAGE_GUILD,
                        PERMISSION_MANAGE_ROLES,
                        PERMISSION_MANAGE_CHANNELS
                );
        });

        let channelPaneRef: ChannelPaneHandle | null = null;

        const triggerCreateChannel = () => {
                channelPaneRef?.openCreateChannel();
        };

        const triggerCreateCategory = () => {
                channelPaneRef?.openCreateCategory();
        };

        const triggerOpenGuildSettings = () => {
                if (!$canAccessSelectedGuildSettings) return;
                guildSettingsOpen.set(true);
        };

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
		{#if $activeView === 'user'}
			<UserScreen />
		{:else}
                        <div class="flex h-full min-h-0 flex-col overflow-hidden">
                                <div
                                        class="box-border flex h-[var(--header-h)] flex-shrink-0 items-center justify-between overflow-hidden border-b border-[var(--stroke)] px-3"
                                >
                                        <div class="truncate font-semibold">
                                                {$guilds.find((g) => String((g as any).id) === $selectedGuildId)?.name ?? m.select_server()}
                                        </div>
                                        {#if $selectedGuildId}
                                                <div class="flex items-center gap-2">
                                                        <button
                                                                class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
                                                                onclick={triggerCreateChannel}
                                                                aria-label={m.new_channel()}
                                                        >
                                                                <Plus class="h-4 w-4" stroke-width={2} />
                                                        </button>
                                                        <button
                                                                class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
                                                                onclick={triggerCreateCategory}
                                                                aria-label={m.new_category()}
                                                        >
                                                                <FolderPlus class="h-4 w-4" stroke-width={2} />
                                                        </button>
                                                        {#if canAccessSelectedGuildSettings}
                                                                <button
                                                                        class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
                                                                        onclick={triggerOpenGuildSettings}
                                                                        aria-label={m.server_settings()}
                                                                >
                                                                        <Settings class="h-4 w-4" stroke-width={2} />
                                                                </button>
                                                        {/if}
                                                </div>
                                        {/if}
                                </div>
                                <ChannelPane bind:this={channelPaneRef} />
                        </div>
			<ChatPane />
		{/if}
		<SearchPanel />
		<MemberProfilePanel />
	</div>
	<ContextMenu />
	<ConnectionStatusBar />
</AuthGate>

<svelte:window
	onfocus={updateAppFocus}
	onblur={updateAppFocus}
	onvisibilitychange={updateAppFocus}
	onkeydown={handleKeyDown}
/>
