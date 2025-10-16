<script lang="ts">
	import SettingsPanel from '$lib/components/ui/SettingsPanel.svelte';
	import FolderSettings from '$lib/components/app/settings/FolderSettings.svelte';
	import { folderSettingsOpen, folderSettingsRequest } from '$lib/stores/settings';

	let focusRequest = $state<{
		folderId: string;
		requestId: number;
	} | null>(null);

	function closeOverlay() {
		folderSettingsOpen.set(false);
		focusRequest = null;
	}

	$effect(() => {
		if (!$folderSettingsOpen) {
			focusRequest = null;
		}
	});

	$effect(() => {
		const request = $folderSettingsRequest;
		if (!request) return;
		focusRequest = request;
		folderSettingsOpen.set(true);
		folderSettingsRequest.set(null);
	});
</script>

<SettingsPanel
	bind:open={$folderSettingsOpen}
	on:close={closeOverlay}
	sidebarClass="hidden border-none p-0"
>
	<FolderSettings {focusRequest} />
</SettingsPanel>
