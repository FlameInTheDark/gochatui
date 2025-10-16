<script lang="ts">
        import { onDestroy } from 'svelte';

        export let initialAvatarUrl: string | null = null;
        export let fallbackInitial = '?';
        export let croppedDataUrl: string | null = null;

        let avatarError: string | null = null;

        let imageObjectUrl: string | null = null;
        let imageElement: HTMLImageElement | null = null;
        let imageReady = false;

        const cropSize = 256;
        let minScale = 1;
        let scale = 1;
        let zoom = 1;
        let offset = { x: 0, y: 0 };
        let dragging = false;
        let dragPointerId: number | null = null;
        let dragOrigin = { x: 0, y: 0 };
        let dragOffsetStart = { x: 0, y: 0 };

        let previewCanvas: HTMLCanvasElement | null = null;

        $: displayAvatarUrl = croppedDataUrl ?? initialAvatarUrl;

        $: if (imageReady && imageElement && previewCanvas) {
                drawPreview(imageElement, previewCanvas, scale, offset.x, offset.y);
        }

        function handleAvatarSelection(event: Event) {
                const input = event.currentTarget as HTMLInputElement | null;
                const file = input?.files?.[0] ?? null;
                if (!file) {
                        return;
                }

                if (!file.type.startsWith('image/')) {
                        avatarError = 'Please choose an image file.';
                        return;
                }

                avatarError = null;
                croppedDataUrl = null;
                imageReady = false;
                imageElement = null;
                offset = { x: 0, y: 0 };
                zoom = 1;
                scale = 1;
                dragging = false;

                if (imageObjectUrl) {
                        URL.revokeObjectURL(imageObjectUrl);
                }
                imageObjectUrl = URL.createObjectURL(file);
                if (input) {
                        input.value = '';
                }
        }

        function handleImageLoad(event: Event) {
                const element = event.currentTarget as HTMLImageElement | null;
                if (!element) {
                        avatarError = 'Could not load image.';
                        return;
                }

                const { naturalWidth, naturalHeight } = element;
                if (!naturalWidth || !naturalHeight) {
                        avatarError = 'Image appears to be empty.';
                        return;
                }

                imageElement = element;
                const baseScale = cropSize / Math.min(naturalWidth, naturalHeight);
                minScale = baseScale;
                scale = baseScale;
                zoom = 1;

                const scaledWidth = naturalWidth * scale;
                const scaledHeight = naturalHeight * scale;
                const initialX = (cropSize - scaledWidth) / 2;
                const initialY = (cropSize - scaledHeight) / 2;
                offset = clampOffset(initialX, initialY, scale);

                imageReady = true;
        }

        function clampOffset(x: number, y: number, currentScale: number) {
                if (!imageElement) return { x, y };
                const width = imageElement.naturalWidth * currentScale;
                const height = imageElement.naturalHeight * currentScale;
                const minX = cropSize - width;
                const minY = cropSize - height;
                const clampedX = Math.min(Math.max(x, minX), 0);
                const clampedY = Math.min(Math.max(y, minY), 0);
                return { x: clampedX, y: clampedY };
        }

        function startDrag(event: PointerEvent) {
                if (!imageReady || !event.currentTarget) return;
                if (event.currentTarget instanceof HTMLElement) {
                        dragging = true;
                        dragPointerId = event.pointerId;
                        dragOrigin = { x: event.clientX, y: event.clientY };
                        dragOffsetStart = { ...offset };
                        event.currentTarget.setPointerCapture(dragPointerId);
                }
        }

        function handleDrag(event: PointerEvent) {
                if (!dragging) return;
                const dx = event.clientX - dragOrigin.x;
                const dy = event.clientY - dragOrigin.y;
                const next = clampOffset(dragOffsetStart.x + dx, dragOffsetStart.y + dy, scale);
                if (next.x !== offset.x || next.y !== offset.y) {
                        offset = next;
                }
        }

        function endDrag(event: PointerEvent) {
                if (!dragging) return;
                dragging = false;
                if (dragPointerId != null && event.currentTarget instanceof HTMLElement) {
                        event.currentTarget.releasePointerCapture(dragPointerId);
                }
                dragPointerId = null;
        }

        function handleZoomInput(event: Event) {
                if (!imageReady || !imageElement) return;
                const input = event.currentTarget as HTMLInputElement | null;
                if (!input) return;
                const newZoom = Number(input.value);
                if (!Number.isFinite(newZoom) || newZoom <= 0) return;

                const previousScale = scale;
                const nextScale = minScale * newZoom;
                if (!Number.isFinite(nextScale) || nextScale <= 0) return;

                const centerX = (cropSize / 2 - offset.x) / previousScale;
                const centerY = (cropSize / 2 - offset.y) / previousScale;

                const nextX = cropSize / 2 - centerX * nextScale;
                const nextY = cropSize / 2 - centerY * nextScale;

                const clamped = clampOffset(nextX, nextY, nextScale);
                offset = clamped;
                scale = nextScale;
                zoom = newZoom;
        }

        function drawPreview(
                image: HTMLImageElement,
                canvas: HTMLCanvasElement,
                currentScale: number,
                offsetX: number,
                offsetY: number
        ) {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const sampleSize = cropSize / currentScale;
                const sx = Math.max(0, -offsetX / currentScale);
                const sy = Math.max(0, -offsetY / currentScale);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(image, sx, sy, sampleSize, sampleSize, 0, 0, canvas.width, canvas.height);
                croppedDataUrl = canvas.toDataURL('image/png');
        }

        function resetAvatar() {
                croppedDataUrl = null;
                avatarError = null;
                imageReady = false;
                imageElement = null;
                offset = { x: 0, y: 0 };
                zoom = 1;
                scale = 1;
                dragging = false;
                if (previewCanvas) {
                        const ctx = previewCanvas.getContext('2d');
                        ctx?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                }
                if (imageObjectUrl) {
                        URL.revokeObjectURL(imageObjectUrl);
                        imageObjectUrl = null;
                }
        }

        onDestroy(() => {
                if (imageObjectUrl) {
                        URL.revokeObjectURL(imageObjectUrl);
                        imageObjectUrl = null;
                }
        });
</script>

<div class="panel space-y-4 p-4">
        <div class="flex items-center justify-between gap-3">
                <div>
                        <div class="text-sm font-medium">Avatar</div>
                        <p class="text-xs text-[var(--muted)]">
                                Select an image, adjust the crop, and preview how it will look.
                        </p>
                </div>
                <div
                        class="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)]"
                >
                        {#if displayAvatarUrl}
                                <img alt="Avatar preview" class="h-full w-full object-cover" src={displayAvatarUrl} />
                        {:else}
                                <span class="text-lg font-semibold text-[var(--muted)]">{fallbackInitial}</span>
                        {/if}
                </div>
        </div>

        <label class="block text-sm font-medium" for="profile-avatar-upload">Upload image</label>
        <input
                accept="image/*"
                class="w-full text-sm"
                id="profile-avatar-upload"
                type="file"
                onchange={handleAvatarSelection}
        />

        {#if imageObjectUrl}
                <div class="flex flex-col gap-3 md:flex-row md:items-start">
                        <div class="avatar-crop-container">
                                <div
                                        class={`avatar-crop-area ${dragging ? 'is-dragging' : ''}`}
                                        onpointerdown={startDrag}
                                        onpointermove={handleDrag}
                                        onpointerup={endDrag}
                                        onpointercancel={endDrag}
                                        onpointerleave={endDrag}
                                >
                                        <img
                                                alt="Crop source"
                                                class="avatar-source"
                                                onload={handleImageLoad}
                                                src={imageObjectUrl}
                                                style={`transform: translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale});`}
                                        />
                                        <div class="avatar-crop-overlay" aria-hidden="true"></div>
                                </div>
                        </div>
                        <div class="flex flex-1 flex-col gap-3">
                                <div>
                                        <div class="flex items-center justify-between text-xs font-medium text-[var(--muted)]">
                                                <span>Zoom</span>
                                                <span>{zoom.toFixed(2)}×</span>
                                        </div>
                                        <input
                                                class="w-full"
                                                max="4"
                                                min="1"
                                                step="0.01"
                                                type="range"
                                                value={zoom}
                                                oninput={handleZoomInput}
                                        />
                                </div>
                                <div>
                                        <div class="text-xs font-medium text-[var(--muted)]">Cropped preview (128×128)</div>
                                        {#if croppedDataUrl}
                                                <img
                                                        alt="Cropped avatar"
                                                        class="mt-2 h-32 w-32 rounded-full border border-[var(--stroke)]"
                                                        height="128"
                                                        src={croppedDataUrl}
                                                        width="128"
                                                />
                                        {:else}
                                                <div
                                                        class="mt-2 flex h-32 w-32 items-center justify-center rounded-full border border-dashed border-[var(--stroke)] text-xs text-[var(--muted)]"
                                                >
                                                        Adjust the crop to see preview
                                                </div>
                                        {/if}
                                </div>
                                <button class="self-start rounded-md border border-[var(--stroke)] px-3 py-1 text-sm" onclick={resetAvatar}>
                                        Reset avatar selection
                                </button>
                        </div>
                </div>
        {/if}

        {#if avatarError}
                <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {avatarError}
                </div>
        {/if}

        <canvas bind:this={previewCanvas} class="hidden" height="128" width="128"></canvas>
</div>

<style>
        .avatar-crop-container {
                width: 256px;
        }

        .avatar-crop-area {
                position: relative;
                width: 256px;
                height: 256px;
                overflow: hidden;
                border-radius: 16px;
                border: 1px solid var(--stroke);
                background: var(--panel-strong);
                cursor: grab;
                touch-action: none;
        }

        .avatar-crop-area.is-dragging {
                cursor: grabbing;
        }

        .avatar-source {
                position: absolute;
                top: 0;
                left: 0;
                transform-origin: top left;
                user-select: none;
                pointer-events: none;
        }

        .avatar-crop-overlay {
                position: absolute;
                inset: 0;
                pointer-events: none;
                border-radius: 16px;
        }

        .avatar-crop-overlay::after {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: inherit;
                background: radial-gradient(
                        circle at center,
                        transparent calc(50% - 3px),
                        rgba(0, 0, 0, 0.35) calc(50% - 3px),
                        rgba(0, 0, 0, 0.35) calc(50% - 2px),
                        rgba(255, 255, 255, 0.75) calc(50% - 2px),
                        rgba(255, 255, 255, 0.75) calc(50% + 2px),
                        rgba(0, 0, 0, 0.45) calc(50% + 2px)
                );
        }

        @media (max-width: 640px) {
                .avatar-crop-container {
                        width: 100%;
                }

                .avatar-crop-area {
                        width: 100%;
                        max-width: 256px;
                }
        }
</style>
