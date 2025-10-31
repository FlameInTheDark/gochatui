<script lang="ts">
        import type { GuildItem, ServerBarCallbacks } from './types';

        const props = $props<{
                item: GuildItem;
                callbacks: ServerBarCallbacks;
                isDropTarget?: boolean;
                isDragging?: boolean;
        }>();

        let { item, callbacks, isDropTarget = false, isDragging = false } = props;
</script>

<li
        class={`guild draggable${item.unread ? ' has-unread' : ''}${isDropTarget ? ' drop-into' : ''}`}
        data-id={item.id}
        aria-label={item.name}
        draggable="true"
        aria-grabbed={isDragging ? 'true' : undefined}
        ondragstart={(event) => callbacks.onItemDragStart(event, item)}
        ondragend={(event) => callbacks.onItemDragEnd(event, item)}
        ondragover={(event) => callbacks.onItemDragOver(event, item)}
        ondragleave={(event) => callbacks.onItemDragLeave(event, item)}
        ondrop={(event) => callbacks.onItemDrop(event, item)}
        onmouseenter={(event) => callbacks.onItemMouseEnter(event, item)}
        onmouseleave={(event) => callbacks.onItemMouseLeave(event, item)}
        onmousemove={(event) => callbacks.onItemMouseMove(event, item)}
>
        <button type="button" class="circle focus-ring">
                <div class="avatar" style={`background: ${item.color}`}>{item.letter ?? item.name.charAt(0)}</div>
        </button>
        {#if (item.mentions ?? 0) > 0}
                <span class="badge">{(item.mentions ?? 0) > 99 ? '99+' : String(item.mentions ?? 0)}</span>
        {/if}
        <span class="unread-ind"></span>
</li>
