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
        let zoom = 1;
        let maskSize = cropSize;
        let maskPosition = { x: 0, y: 0 };
        let maskDragging = false;
        let dragPointerId: number | null = null;
        let dragOrigin = { x: 0, y: 0 };
        let dragMaskStart = { x: 0, y: 0 };

        let imageFitScale = 1;
        let imageDisplayWidth = 0;
        let imageDisplayHeight = 0;
        let imageOffset = { x: 0, y: 0 };

        let previewCanvas: HTMLCanvasElement | null = null;

        $: maskRadius = maskSize / 2;
        $: maskCenter = { x: maskPosition.x + maskRadius, y: maskPosition.y + maskRadius };
        $: overlayBackground = `radial-gradient(circle at ${maskCenter.x}px ${maskCenter.y}px, transparent ${Math.max(
                maskRadius - 1,
                0
        )}px, rgba(0, 0, 0, 0.45) ${maskRadius}px)`;

        $: displayAvatarUrl = croppedDataUrl ?? initialAvatarUrl;

        $: if (imageReady && imageElement && previewCanvas) {
                drawPreview(
                        imageElement,
                        previewCanvas,
                        maskPosition,
                        maskSize,
                        imageFitScale,
                        imageOffset
                );
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
                zoom = 1;
                maskSize = cropSize;
                maskPosition = centerMask(maskSize);
                maskDragging = false;
                imageFitScale = 1;
                imageDisplayWidth = 0;
                imageDisplayHeight = 0;
                imageOffset = { x: 0, y: 0 };

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
                imageFitScale = Math.max(cropSize / naturalWidth, cropSize / naturalHeight);
                imageDisplayWidth = naturalWidth * imageFitScale;
                imageDisplayHeight = naturalHeight * imageFitScale;
                imageOffset = {
                        x: (cropSize - imageDisplayWidth) / 2,
                        y: (cropSize - imageDisplayHeight) / 2
                };

                zoom = 1;
                maskSize = cropSize;
                maskPosition = centerMask(maskSize);
                maskDragging = false;

                imageReady = true;
        }

        function centerMask(size: number) {
                const start = (cropSize - size) / 2;
                return { x: start, y: start };
        }

        function clampMaskPosition(x: number, y: number, size: number) {
                const max = Math.max(cropSize - size, 0);
                return {
                        x: Math.min(Math.max(x, 0), max),
                        y: Math.min(Math.max(y, 0), max)
                };
        }

        function startMaskDrag(event: PointerEvent) {
                if (!imageReady || !event.currentTarget) return;
                if (!(event.currentTarget instanceof HTMLElement)) return;

                const rect = event.currentTarget.getBoundingClientRect();
                const pointerX = event.clientX - rect.left;
                const pointerY = event.clientY - rect.top;
                const radius = maskSize / 2;
                const maskCenterX = maskPosition.x + radius;
                const maskCenterY = maskPosition.y + radius;
                const distanceSq =
                        (pointerX - maskCenterX) * (pointerX - maskCenterX) +
                        (pointerY - maskCenterY) * (pointerY - maskCenterY);

                if (distanceSq > radius * radius) {
                        const recentered = clampMaskPosition(pointerX - radius, pointerY - radius, maskSize);
                        maskPosition = recentered;
                }

                maskDragging = true;
                dragPointerId = event.pointerId;
                dragOrigin = { x: pointerX, y: pointerY };
                dragMaskStart = { ...maskPosition };
                event.currentTarget.setPointerCapture(dragPointerId);
        }

        function handleMaskDrag(event: PointerEvent) {
                if (!maskDragging || dragPointerId !== event.pointerId) return;
                if (!(event.currentTarget instanceof HTMLElement)) return;

                const rect = event.currentTarget.getBoundingClientRect();
                const pointerX = event.clientX - rect.left;
                const pointerY = event.clientY - rect.top;
                const dx = pointerX - dragOrigin.x;
                const dy = pointerY - dragOrigin.y;
                const next = clampMaskPosition(dragMaskStart.x + dx, dragMaskStart.y + dy, maskSize);
                if (next.x !== maskPosition.x || next.y !== maskPosition.y) {
                        maskPosition = next;
                }
        }

        function endMaskDrag(event: PointerEvent) {
                if (!maskDragging || dragPointerId !== event.pointerId) return;
                maskDragging = false;
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

                const nextSize = cropSize / newZoom;
                const previousCenter = {
                        x: maskPosition.x + maskSize / 2,
                        y: maskPosition.y + maskSize / 2
                };

                const nextPosition = clampMaskPosition(
                        previousCenter.x - nextSize / 2,
                        previousCenter.y - nextSize / 2,
                        nextSize
                );

                maskSize = nextSize;
                maskPosition = nextPosition;
                zoom = newZoom;
        }

        function drawPreview(
                image: HTMLImageElement,
                canvas: HTMLCanvasElement,
                mask: { x: number; y: number },
                size: number,
                fitScale: number,
                displayOffset: { x: number; y: number }
        ) {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const sampleSize = size / fitScale;
                const sx = (mask.x - displayOffset.x) / fitScale;
                const sy = (mask.y - displayOffset.y) / fitScale;
                const clampedSx = Math.min(
                        Math.max(sx, 0),
                        Math.max(image.naturalWidth - sampleSize, 0)
                );
                const clampedSy = Math.min(
                        Math.max(sy, 0),
                        Math.max(image.naturalHeight - sampleSize, 0)
                );
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(
                        image,
                        clampedSx,
                        clampedSy,
                        sampleSize,
                        sampleSize,
                        0,
                        0,
                        canvas.width,
                        canvas.height
                );
                croppedDataUrl = canvas.toDataURL('image/png');
        }

        function resetAvatar() {
                croppedDataUrl = null;
                avatarError = null;
                imageReady = false;
                imageElement = null;
                zoom = 1;
                maskSize = cropSize;
                maskPosition = centerMask(maskSize);
                maskDragging = false;
                imageFitScale = 1;
                imageDisplayWidth = 0;
                imageDisplayHeight = 0;
                imageOffset = { x: 0, y: 0 };
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
                                <div class="avatar-crop-area">
                                        <img
                                                alt="Crop source"
                                                class="avatar-source"
                                                onload={handleImageLoad}
                                                src={imageObjectUrl}
                                                style={`width: ${imageDisplayWidth}px; height: ${imageDisplayHeight}px; transform: translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0);`}
                                        />
                                        <div
                                                aria-hidden="true"
                                                class={`avatar-crop-overlay ${maskDragging ? 'is-dragging' : ''}`}
                                                style={`background: ${overlayBackground};`}
                                                onpointerdown={startMaskDrag}
                                                onpointermove={handleMaskDrag}
                                                onpointerup={endMaskDrag}
                                                onpointercancel={endMaskDrag}
                                        >
                                                <div
                                                        class="avatar-crop-ring"
                                                        style={`width: ${maskSize}px; height: ${maskSize}px; transform: translate(${maskPosition.x}px, ${maskPosition.y}px);`}
                                                ></div>
                                        </div>
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
        }

        .avatar-source {
                position: absolute;
                top: 0;
                left: 0;
                transform-origin: top left;
                user-select: none;
                pointer-events: none;
                will-change: transform;
        }

        .avatar-crop-overlay {
                position: absolute;
                inset: 0;
                cursor: grab;
                touch-action: none;
        }

        .avatar-crop-overlay.is-dragging {
                cursor: grabbing;
        }

        .avatar-crop-ring {
                position: absolute;
                top: 0;
                left: 0;
                border-radius: 50%;
                box-shadow:
                        inset 0 0 0 2px rgba(255, 255, 255, 0.85),
                        0 0 0 1px rgba(0, 0, 0, 0.55);
                pointer-events: none;
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
