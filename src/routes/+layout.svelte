<script lang="ts">
        import '../app.css';
        import { tooltipButtons } from '$lib/actions/tooltip-buttons';
        import favicon from '$lib/assets/favicon.svg';
        import SettingsOverlay from '$lib/components/app/settings/SettingsOverlay.svelte';
        import FolderSettingsOverlay from '$lib/components/app/settings/FolderSettingsOverlay.svelte';
        import GuildSettingsOverlay from '$lib/components/app/settings/GuildSettingsOverlay.svelte';
        import TooltipLayer from '$lib/components/ui/TooltipLayer.svelte';

	let { children } = $props();
</script>

<svelte:head>
        <link rel="icon" href={favicon} />
</svelte:head>

<svelte:body use:tooltipButtons />

{@render children?.()}

<SettingsOverlay />
<FolderSettingsOverlay />
<GuildSettingsOverlay />
<TooltipLayer />
