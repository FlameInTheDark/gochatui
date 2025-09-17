<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import SettingsOverlay from '$lib/components/app/settings/SettingsOverlay.svelte';
	import GuildSettingsOverlay from '$lib/components/app/settings/GuildSettingsOverlay.svelte';
	import ConnectionStatusBar from '$lib/components/app/ConnectionStatusBar.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}

<SettingsOverlay />
<GuildSettingsOverlay />
<ConnectionStatusBar />
