<script lang="ts">
        import { browser } from '$app/environment';
        import { onDestroy, onMount } from 'svelte';

        import {
                DEFAULT_STORAGE_KEY,
                addToFolder,
                cloneState,
                computeIntent,
                createFolderFromTwo,
                createSeedState,
                findPathTo,
                findWithParent,
                getDragId,
                insertAt,
                loadState,
                normalizeFolders,
                removeById,
                saveState
        } from './state';
        import ServerList from './ServerList.svelte';
        import type {
                DragPosition,
                FolderItem,
                ServerBarCallbacks,
                ServerBarState,
                ServerItem,
                TooltipState
        } from './types';

        const props = $props<{ storageKey?: string; seed?: ServerBarState }>();
        let { storageKey = DEFAULT_STORAGE_KEY, seed = createSeedState() } = props;

        let state = $state<ServerBarState>(cloneState(seed));
        let guildListEl: HTMLUListElement | null = $state(null);
        let draggingId = $state<string | null>(null);
        let dropIntoId = $state<string | null>(null);
        let dropLine = $state<DragPosition>({ visible: false, top: 0, left: 0, right: 0 });
        let tooltip = $state<TooltipState>({ visible: false, text: '', x: 0, y: 0 });
        let rootInsertIndex = $state<number | null>(null);

        let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

        const updateState = (mutator: (draft: ServerBarState) => void) => {
                const draft = cloneState(state);
                mutator(draft);
                state = draft;
        };

        function ensureStateLoaded() {
                if (!browser) return;
                state = loadState(storageKey, seed);
        }

        onMount(() => {
                ensureStateLoaded();
                const handleVisibility = () => {
                        if (document.hidden) {
                                hideTooltipImmediate();
                        }
                };
                document.addEventListener('visibilitychange', handleVisibility);
                return () => document.removeEventListener('visibilitychange', handleVisibility);
        });

        $effect(() => {
                saveState(storageKey, state);
        });

        function cleanupDropUi() {
                dropLine = { visible: false, top: 0, left: 0, right: 0 };
                dropIntoId = null;
                rootInsertIndex = null;
        }

        function showDropLine(rect: DOMRect, position: 'before' | 'after') {
                dropLine = {
                        visible: true,
                        top: position === 'before' ? rect.top - 2 : rect.bottom - 2,
                        left: rect.left + 8,
                        right: window.innerWidth - rect.right + 8
                };
                dropIntoId = null;
        }

        function clearDropLine() {
                dropLine = { ...dropLine, visible: false };
        }

        function setDropInto(id: string | null) {
                dropIntoId = id;
                if (id) {
                        clearDropLine();
                }
        }

        function handleItemDragStart(event: DragEvent, item: ServerItem) {
                event.stopPropagation();
                draggingId = item.id;
                const target = event.currentTarget as HTMLElement | null;
                target?.setAttribute('aria-grabbed', 'true');
                const circle = target?.querySelector<HTMLElement>('.circle');
                try {
                        if (circle) {
                                event.dataTransfer?.setDragImage(circle, circle.offsetWidth / 2, circle.offsetHeight / 2);
                        }
                        event.dataTransfer?.setData('text/x-serverbar-id', item.id);
                        event.dataTransfer?.setData('text/plain', item.id);
                        if (event.dataTransfer) {
                                event.dataTransfer.dropEffect = 'move';
                                event.dataTransfer.effectAllowed = 'move';
                        }
                } catch {
                        /* noop */
                }
        }

        function handleItemDragEnd(event: DragEvent, item: ServerItem) {
                event.stopPropagation();
                const target = event.currentTarget as HTMLElement | null;
                target?.removeAttribute('aria-grabbed');
                draggingId = null;
                cleanupDropUi();
        }

        function handleItemDragOver(event: DragEvent, item: ServerItem) {
                if (!draggingId) return;
                event.preventDefault();
                event.stopPropagation();
                const target = event.currentTarget as HTMLElement | null;
                if (!target) return;
                const rect = target.getBoundingClientRect();
                const y = event.clientY - rect.top;
                const baseIntent = computeIntent(y, rect.height);
                const inFolder = Boolean(target.closest('.folder .folder-contents'));
                const intent: 'before' | 'after' | 'into' =
                        inFolder && baseIntent === 'into' ? (y < rect.height / 2 ? 'before' : 'after') : baseIntent;

                if (intent === 'before' || intent === 'after') {
                        setDropInto(null);
                        showDropLine(rect, intent);
                } else {
                        clearDropLine();
                        setDropInto(item.id);
                }
        }

        function handleItemDragLeave(event: DragEvent, item: ServerItem) {
                event.stopPropagation();
                const target = event.currentTarget as HTMLElement | null;
                if (!target) return;
                const id = target.dataset.id;
                if (dropIntoId === id) {
                        setDropInto(null);
                }
        }

        function isDescendant(draft: ServerBarState, ancestorId: string, possibleChildId: string): boolean {
                if (ancestorId === possibleChildId) return true;
                const path = findPathTo(draft.items, possibleChildId) ?? [];
                return path.includes(ancestorId);
        }

        function handleItemDrop(event: DragEvent, item: ServerItem) {
                if (!draggingId) return;
                event.preventDefault();
                event.stopPropagation();
                const target = event.currentTarget as HTMLElement | null;
                if (!target) return;
                const targetId = item.id;
                const dragId = getDragId(event, draggingId);
                if (!dragId || dragId === targetId) {
                        cleanupDropUi();
                        return;
                }

                updateState((draft) => {
                        if (isDescendant(draft, dragId, targetId)) {
                                return;
                        }

                        const rect = target.getBoundingClientRect();
                        const y = event.clientY - rect.top;
                        const baseIntent = computeIntent(y, rect.height);
                        const inFolder = Boolean(target.closest('.folder .folder-contents'));
                        const intent: 'before' | 'after' | 'into' =
                                inFolder && baseIntent === 'into'
                                        ? y < rect.height / 2
                                                ? 'before'
                                                : 'after'
                                        : baseIntent;

                        const targetInfo = findWithParent(draft.items, targetId);
                        if (!targetInfo) return;

                        if (intent === 'into') {
                                if (targetInfo.item.type === 'folder') {
                                        const moved = removeById(draft, dragId, { preserveFolder: true });
                                        if (!moved) return;
                                        if (moved.type === 'guild') {
                                                addToFolder(targetInfo.item, moved);
                                        } else {
                                                const folderInfo = findWithParent(draft.items, targetInfo.item.id);
                                                const index = folderInfo ? folderInfo.index : draft.items.length;
                                                insertAt(draft.items, index, moved);
                                        }
                                        normalizeFolders(draft.items);
                                } else {
                                        const dragInfo = findWithParent(draft.items, dragId);
                                        if (dragInfo?.item.type === 'guild') {
                                                createFolderFromTwo(draft, dragId, targetId, targetInfo.index);
                                        } else {
                                                const moved = removeById(draft, dragId, { preserveFolder: true });
                                                if (!moved) return;
                                                const refreshed = findWithParent(draft.items, targetId);
                                                const index = refreshed ? refreshed.index : draft.items.length;
                                                insertAt(draft.items, index, moved);
                                                normalizeFolders(draft.items);
                                        }
                                }
                                return;
                        }

                        const moved = removeById(draft, dragId, { preserveFolder: true });
                        if (!moved) return;

                        if (inFolder) {
                                const folderEl = target.closest('li.folder') as HTMLElement | null;
                                const folderId = folderEl?.dataset.id;
                                if (!folderId) {
                                        insertAt(draft.items, draft.items.length, moved);
                                        normalizeFolders(draft.items);
                                        return;
                                }
                                if (moved.type === 'folder') {
                                        const folderInfo = findWithParent(draft.items, folderId);
                                        const index = folderInfo
                                                ? intent === 'before'
                                                        ? folderInfo.index
                                                        : folderInfo.index + 1
                                                : draft.items.length;
                                        insertAt(draft.items, index, moved);
                                } else {
                                        const folderInfo = findWithParent(draft.items, folderId);
                                        if (folderInfo?.item.type === 'folder') {
                                                const siblingInfo = findWithParent(folderInfo.item.children, targetId);
                                                const index = siblingInfo
                                                        ? intent === 'before'
                                                                ? siblingInfo.index
                                                                : siblingInfo.index + 1
                                                        : folderInfo.item.children.length;
                                                addToFolder(folderInfo.item, moved, index);
                                        }
                                }
                        } else {
                                const refreshed = findWithParent(draft.items, targetId);
                                const index = refreshed
                                        ? intent === 'before'
                                                ? refreshed.index
                                                : refreshed.index + 1
                                        : draft.items.length;
                                insertAt(draft.items, index, moved);
                        }
                        normalizeFolders(draft.items);
                });

                cleanupDropUi();
        }

        function handleItemMouseEnter(event: MouseEvent, item: ServerItem) {
                const target = event.currentTarget as HTMLElement | null;
                if (!target) return;
                const text = item.type === 'folder' ? `${item.name} (folder)` : item.name;
                showTooltip(target, text);
        }

        function handleItemMouseLeave(_event?: MouseEvent, _item?: ServerItem) {
                scheduleTooltipHide();
        }

        function handleItemMouseMove(event: MouseEvent) {
                const target = event.currentTarget as HTMLElement | null;
                if (!target) return;
                updateTooltipPosition(target);
        }

        function handleFolderToggle(folder: FolderItem) {
                updateState((draft) => {
                        const info = findWithParent(draft.items, folder.id);
                        if (info && info.item.type === 'folder') {
                                info.item.collapsed = !info.item.collapsed;
                        }
                });
        }

        function handleReset() {
                state = cloneState(seed);
                saveState(storageKey, state);
        }

        function handleKeyDown(event: KeyboardEvent) {
                const active = (event.target as HTMLElement | null)?.closest('[data-id]') as HTMLElement | null;
                if (!active) return;
                const id = active.dataset.id;
                if (!id) return;
                if (event.key === 'Enter') {
                        event.preventDefault();
                        updateState((draft) => {
                                const info = findWithParent(draft.items, id);
                                if (info?.item.type === 'folder') {
                                        info.item.collapsed = !info.item.collapsed;
                                }
                        });
                        return;
                }
                if (event.key === 'Delete') {
                        event.preventDefault();
                        updateState((draft) => {
                                const info = findWithParent(draft.items, id);
                                if (info?.item.type === 'guild') {
                                        info.item.unread = false;
                                        info.item.mentions = 0;
                                }
                        });
                }
        }

        function computeRootIndex(clientY: number): number {
                if (!guildListEl) return state.items.length;
                const children = Array.from(guildListEl.children) as HTMLElement[];
                for (let index = 0; index < children.length; index += 1) {
                        const rect = children[index].getBoundingClientRect();
                        const mid = (rect.top + rect.bottom) / 2;
                        if (clientY < mid) return index;
                }
                return children.length;
        }

        function handleRootDragOver(event: DragEvent) {
                if (!draggingId) return;
                event.preventDefault();
                if (!guildListEl) return;
                const listRect = guildListEl.getBoundingClientRect();
                const index = computeRootIndex(event.clientY);
                rootInsertIndex = index;
                const children = Array.from(guildListEl.children) as HTMLElement[];
                let top: number;
                if (index === 0) {
                                const first = children[0];
                                top = first ? first.getBoundingClientRect().top - 2 : listRect.top + 8;
                } else if (index >= children.length) {
                                const last = children[children.length - 1];
                                top = last ? last.getBoundingClientRect().bottom - 2 : listRect.bottom - 10;
                } else {
                                const prev = children[index - 1];
                                top = prev.getBoundingClientRect().bottom - 2;
                }
                dropLine = {
                        visible: true,
                        top,
                        left: listRect.left + 16,
                        right: window.innerWidth - listRect.right + 16
                };
                dropIntoId = null;
        }

        function handleRootDrop(event: DragEvent) {
                if (!draggingId) return;
                event.preventDefault();
                const id = getDragId(event, draggingId);
                if (!id) {
                        cleanupDropUi();
                        return;
                }
                updateState((draft) => {
                        const moved = removeById(draft, id, { preserveFolder: true });
                        if (!moved) return;
                        const index = rootInsertIndex == null ? draft.items.length : rootInsertIndex;
                        insertAt(draft.items, index, moved);
                        normalizeFolders(draft.items);
                });
                cleanupDropUi();
        }

        function showTooltip(target: HTMLElement, text: string) {
                const rect = target.getBoundingClientRect();
                tooltip = {
                        visible: true,
                        text,
                        x: rect.right + 14,
                        y: rect.top + rect.height / 2 - 16
                };
                if (tooltipTimer) {
                        clearTimeout(tooltipTimer);
                        tooltipTimer = null;
                }
        }

        function updateTooltipPosition(target: HTMLElement) {
                if (!tooltip.visible) return;
                const rect = target.getBoundingClientRect();
                tooltip = { ...tooltip, x: rect.right + 14, y: rect.top + rect.height / 2 - 16 };
        }

        function scheduleTooltipHide() {
                if (tooltipTimer) {
                        clearTimeout(tooltipTimer);
                }
                tooltipTimer = setTimeout(() => hideTooltipImmediate(), 80);
        }

        function hideTooltipImmediate() {
                if (tooltipTimer) {
                        clearTimeout(tooltipTimer);
                        tooltipTimer = null;
                }
                tooltip = { ...tooltip, visible: false };
        }

        onDestroy(() => {
                if (tooltipTimer) {
                        clearTimeout(tooltipTimer);
                        tooltipTimer = null;
                }
        });

        const callbacks: ServerBarCallbacks = {
                onItemDragStart: handleItemDragStart,
                onItemDragEnd: handleItemDragEnd,
                onItemDragOver: handleItemDragOver,
                onItemDragLeave: handleItemDragLeave,
                onItemDrop: handleItemDrop,
                onItemMouseEnter: handleItemMouseEnter,
                onItemMouseLeave: handleItemMouseLeave,
                onItemMouseMove: handleItemMouseMove,
                onFolderToggle: handleFolderToggle
        };
</script>

<div class="server-bar-demo">
        <nav class="server-bar" aria-label="Servers">
                <button class="home focus-ring" aria-label="Home">
                        <div class="circle"></div>
                </button>

                <div class="separator" role="separator" aria-hidden="true"></div>

                <ul
                        bind:this={guildListEl}
                        id="guildList"
                        class="guild-list"
                        role="listbox"
                        aria-orientation="vertical"
                        ondragover={handleRootDragOver}
                        ondrop={handleRootDrop}
                        onkeydown={handleKeyDown}
                >
                        <ServerList
                                items={state.items}
                                {callbacks}
                                dropIntoId={dropIntoId}
                                draggingId={draggingId}
                        />
                </ul>

                <div class="separator" role="separator" aria-hidden="true"></div>

                <button class="explore focus-ring" aria-label="Explore Discoverability">
                        <div class="circle"></div>
                </button>
        </nav>

        <header class="helper">
                Drag to reorder. Drop <b>one server on another</b> at root to create a folder. Drop <b>on a folder</b> to add
                servers to it. <b>No nested folders</b> — folders live only in the root. State saves to <b>localStorage</b>.
        </header>
        <div class="footer-reset">
                Having fun? <button onclick={handleReset} title="Restore the example structure">Reset Demo</button>
        </div>

        <div
                class={`drop-line${dropLine.visible ? ' show' : ''}`}
                style={`top: ${dropLine.top}px; left: ${dropLine.left}px; right: ${dropLine.right}px;`}
        ></div>

        <div
                class={`tooltip${tooltip.visible ? ' show' : ''}`}
                aria-hidden={tooltip.visible ? 'false' : 'true'}
                style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}
        >
                {tooltip.text}
        </div>
</div>

<style>
        :global(:root) {
                --server-bar-bg: #1f2125;
                --server-bar-bg-2: #181a1f;
                --server-item-bg: #2b2f36;
                --server-item-active: #5865f2;
                --server-unread: #ffffff;
                --server-mention: #f23f42;
                --server-text: #e5e7eb;
                --server-muted: #9aa3b2;
                --server-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
        }

        .server-bar-demo {
                position: relative;
                min-height: 100vh;
                display: flex;
                align-items: stretch;
                background: linear-gradient(135deg, #0f1115, #111418 40%, #0e1014);
                color: var(--server-text);
                font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial,
                        'Apple Color Emoji', 'Segoe UI Emoji';
        }

        .server-bar {
                width: 90px;
                min-width: 90px;
                background: var(--server-bar-bg);
                border-right: 1px solid #0e0f12;
                overflow-y: auto;
                padding: 14px 0 10px;
                position: relative;
                box-shadow: var(--server-shadow);
        }

        .server-bar::-webkit-scrollbar {
                width: 8px;
        }

        .server-bar::-webkit-scrollbar-thumb {
                background: #2a2e35;
                border-radius: 8px;
        }

        .guild-list {
                list-style: none;
                padding: 0;
                margin: 0;
                display: flex;
                flex-direction: column;
                gap: 10px;
        }

        .separator {
                height: 2px;
                background: var(--server-bar-bg-2);
                margin: 10px 12px;
                border-radius: 2px;
        }

        .circle {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                display: grid;
                place-items: center;
                margin: 0 auto;
                position: relative;
                background: var(--server-item-bg);
                transition: transform 0.15s ease, border-radius 0.15s ease, background 0.15s ease;
                cursor: pointer;
                user-select: none;
                outline: none;
                border: none;
                box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 8px 20px rgba(0, 0, 0, 0.35);
        }

        .circle:hover {
                border-radius: 30%;
        }

        :global(.draggable[aria-grabbed='true'] .circle) {
                transform: scale(1.04);
        }

        .home,
        .explore {
                width: 100%;
                background: none;
                border: 0;
                padding: 0;
        }

        .home .circle,
        .explore .circle {
                background: #23a55a;
        }

        .home .circle {
                background: #5865f2;
        }

        .home .circle::after {
                content: '';
                width: 24px;
                height: 24px;
                background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 3l8 6v12h-6v-7H10v7H4V9l8-6z"/></svg>')
                        center/contain no-repeat;
                opacity: 0.9;
        }

        .explore .circle::after {
                content: '';
                width: 26px;
                height: 26px;
                background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 015.657 2.929l-3.9 1.3-1.3 3.9A7 7 0 015 12a7 7 0 017-7z"/></svg>')
                        center/contain no-repeat;
                opacity: 0.9;
        }

        :global(.guild) {
                position: relative;
        }

        :global(.guild .circle) {
                background: var(--server-item-bg);
                border-radius: 16px;
        }

        :global(.guild .circle:hover) {
                border-radius: 16px;
        }

        :global(.folder .circle:hover) {
                border-radius: 16px;
        }

        :global(.guild .avatar) {
                width: 100%;
                height: 100%;
                border-radius: 12px;
                display: grid;
                place-items: center;
                font-weight: 700;
                font-size: 22px;
                letter-spacing: 0.2px;
                color: #fff;
        }

        :global(.unread-ind) {
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 8px;
                height: 8px;
                background: var(--server-unread);
                border-radius: 50%;
                box-shadow: 0 0 0 2px var(--server-bar-bg);
                transition: height 0.12s ease, border-radius 0.12s ease, opacity 0.12s ease;
                opacity: 0;
        }

        :global(.guild.has-unread .unread-ind) {
                opacity: 1;
        }

        :global(.guild:hover .unread-ind),
        :global(.guild:focus-within .unread-ind) {
                height: 28px;
                border-radius: 8px;
                opacity: 1;
        }

        :global(.badge) {
                position: absolute;
                right: 6px;
                bottom: 6px;
                min-width: 22px;
                height: 22px;
                padding: 0 6px;
                background: var(--server-mention);
                color: white;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 800;
                display: grid;
                place-items: center;
                outline: 3px solid var(--server-bar-bg);
        }

        .tooltip {
                position: fixed;
                padding: 8px 10px;
                background: #111217;
                color: #fff;
                font-size: 12px;
                border-radius: 8px;
                pointer-events: none;
                opacity: 0;
                transform: translateY(-6px);
                transition: opacity 0.12s ease, transform 0.12s ease;
                box-shadow: var(--server-shadow);
                z-index: 9999;
        }

        .tooltip.show {
                opacity: 1;
                transform: translateY(0);
        }

        :global(.folder) {
                position: relative;
        }

        :global(.folder > .folder-toggle) {
                width: 100%;
                background: none;
                border: 0;
                padding: 0;
                display: block;
        }

        :global(.folder .folder-circle) {
                background: #20242b;
                border-radius: 16px;
        }

        :global(.folder[aria-expanded='true'] .folder-circle) {
                border-radius: 16px;
        }

        :global(.folder-thumb) {
                position: relative;
                width: 100%;
                height: 100%;
                border-radius: 12px;
                overflow: hidden;
                display: grid;
                place-items: center;
                padding: 6px;
        }

        :global(.folder-grid) {
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
                gap: 6px;
                width: 100%;
                height: 100%;
        }

        :global(.folder-grid .mini) {
                width: 100%;
                height: 100%;
                display: grid;
                place-items: center;
                font-size: 14px;
                font-weight: 800;
                color: #fff;
                border-radius: 8px;
        }

        :global(.folder-thumb.empty) {
                border: 2px dashed rgba(255, 255, 255, 0.25);
        }

        :global(.folder-contents) {
                list-style: none;
                margin: 8px 0 2px;
                padding: 0;
                display: flex;
                flex-direction: column;
                gap: 8px;
        }

        :global(.folder[aria-expanded='false'] .folder-contents) {
                display: none;
        }

        :global(.folder-label) {
                width: 100%;
                height: 100%;
                display: grid;
                place-items: center;
                text-align: center;
                padding: 6px;
                font-size: 11px;
                font-weight: 800;
                color: #e5e7eb;
                line-height: 1.1;
                word-break: break-word;
        }

        .drop-line {
                position: fixed;
                height: 4px;
                background: #87b0ff;
                border-radius: 4px;
                box-shadow: 0 0 0 3px rgba(134, 176, 255, 0.25);
                display: none;
                z-index: 9998;
        }

        .drop-line.show {
                display: block;
        }

        .drop-into {
                outline: 3px dashed #87b0ff;
                outline-offset: 6px;
        }

        header.helper {
                position: fixed;
                left: 108px;
                top: 12px;
                right: 12px;
                background: #0f1217;
                border: 1px solid #0b0d11;
                border-radius: 14px;
                padding: 10px 12px;
                color: var(--server-muted);
                font-size: 13px;
                box-shadow: var(--server-shadow);
        }

        header.helper b {
                color: #cbd5e1;
        }

        .footer-reset {
                position: fixed;
                left: 108px;
                bottom: 12px;
                background: #11151c;
                border: 1px solid #0b0f14;
                padding: 8px 10px;
                border-radius: 10px;
                color: var(--server-muted);
                font-size: 12px;
        }

        .footer-reset button {
                appearance: none;
                background: #202634;
                color: #dbe4ff;
                border: 1px solid #334155;
                border-radius: 8px;
                padding: 6px 10px;
                font-weight: 700;
                cursor: pointer;
        }

        .focus-ring:focus-visible {
                outline: 3px solid #87b0ff;
                outline-offset: 4px;
        }
</style>
