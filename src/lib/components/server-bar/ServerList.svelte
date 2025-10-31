<script lang="ts">
        import type {
                FolderItem,
                ServerBarCallbacks,
                ServerItem
        } from './types';
        import FolderItemComponent from './FolderItem.svelte';
        import GuildItemComponent from './GuildItem.svelte';

        const props = $props<{
                items: ServerItem[];
                callbacks: ServerBarCallbacks;
                dropIntoId?: string | null;
                draggingId?: string | null;
        }>();

        let { items, callbacks, dropIntoId = null, draggingId = null } = props;

        const isFolder = (item: ServerItem): item is FolderItem => item.type === 'folder';
</script>

{#each items as item (item.id)}
        {#if isFolder(item)}
                <FolderItemComponent
                        {item}
                        {callbacks}
                        {dropIntoId}
                        {draggingId}
                />
        {:else}
                <GuildItemComponent
                        item={item}
                        {callbacks}
                        isDropTarget={dropIntoId === item.id}
                        isDragging={draggingId === item.id}
                />
        {/if}
{/each}
