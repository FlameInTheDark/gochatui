<script lang="ts">
        import { onDestroy } from 'svelte';
        import { Download, ImageOff, Paperclip, Play } from 'lucide-svelte';
        import AudioAttachmentPlayer from './AudioAttachmentPlayer.svelte';
        import VideoAttachmentPlayer from './VideoAttachmentPlayer.svelte';
        import {
                GIF_PLACEHOLDER_SRC,
                VISUAL_ATTACHMENT_MAX_DIMENSION,
                attachmentStableKey,
                computeVisualAttachmentBounds,
                createVideoFallbackGradient,
                galleryGridTemplate,
                getAttachmentMeta,
                groupAttachmentsForRender,
                type AttachmentMeta,
                type MessageAttachment,
                visualAttachmentMediaStyle,
                visualAttachmentWrapperStyle,
        } from './messageAttachments';

        const {
                attachments = null,
                messageId = null,
                compact = false,
        } = $props<{
                attachments?: MessageAttachment[] | null | undefined;
                messageId?: string | number | bigint | null | undefined;
                compact?: boolean;
        }>();

        type ImagePreviewState = {
                url: string;
                title: string;
                sizeLabel: string | null;
                contentType: string | null;
        };

        const IMAGE_ZOOM_MIN_DEFAULT = 0.25;
        const IMAGE_ZOOM_MAX = 6;
        const IMAGE_ZOOM_STEP = 0.25;

        type GifPlaybackParams = {
                enabled: boolean;
                src: string | null;
                previewSrc: string | null;
        };

        function gifPlayback(node: HTMLImageElement, params: GifPlaybackParams) {
                let currentParams = params;
                let currentSrc = currentParams?.src ?? null;
                let enabled = Boolean(currentParams?.enabled && currentSrc);
                let previewSrc = currentParams?.previewSrc ?? null;
                let observer: IntersectionObserver | null = null;

                const cleanupObserver = () => {
                        observer?.disconnect();
                        observer = null;
                };

                const setPlaying = (shouldPlay: boolean) => {
                        if (!enabled) {
                                const target = previewSrc ?? GIF_PLACEHOLDER_SRC;
                                if (node.src !== target) {
                                        node.src = target;
                                }
                                return;
                        }

                        const target = shouldPlay && currentSrc ? currentSrc : previewSrc ?? GIF_PLACEHOLDER_SRC;
                        if (node.src !== target) {
                                node.src = target;
                        }
                };

                const handleIntersect = (entries: IntersectionObserverEntry[]) => {
                        for (const entry of entries) {
                                if (entry.target === node) {
                                        const shouldPlay = entry.isIntersecting && entry.intersectionRatio > 0;
                                        setPlaying(shouldPlay);
                                }
                        }
                };

                const initObserver = () => {
                        cleanupObserver();
                        currentSrc = currentParams?.src ?? null;
                        enabled = Boolean(currentParams?.enabled && currentSrc);
                        previewSrc = currentParams?.previewSrc ?? null;

                        if (!enabled) {
                                setPlaying(false);
                                return;
                        }

                        observer = new IntersectionObserver(handleIntersect, {
                                threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
                        });
                        observer.observe(node);
                        setPlaying(false);
                };

                initObserver();

                return {
                        update(nextParams: GifPlaybackParams) {
                                currentParams = nextParams;
                                initObserver();
                        },
                        destroy() {
                                cleanupObserver();
                                const target = previewSrc ?? (enabled && currentSrc ? currentSrc : GIF_PLACEHOLDER_SRC);
                                if (target) {
                                        node.src = target;
                                }
                        },
                };
        }

        function clamp(value: number, min: number, max: number): number {
                return Math.min(Math.max(value, min), max);
        }

        const attachmentList = $derived.by(() => (attachments ?? []) as MessageAttachment[]);
        const attachmentGroups = $derived.by(() => groupAttachmentsForRender(attachmentList));

        let failedPreviewKeys = $state<Record<string, true>>({});
        let videoPreviewPosterFailures = $state<Record<string, boolean>>({});
        let activeVideoAttachments = $state<Record<string, boolean>>({});

        let imagePreview = $state<ImagePreviewState | null>(null);
        let imagePreviewZoom = $state(1);
        let imagePreviewFitZoom = $state(1);
        let imagePreviewOffsetX = $state(0);
        let imagePreviewOffsetY = $state(0);
        let imagePreviewViewport = $state<HTMLDivElement | null>(null);
        let imagePreviewDragging = $state(false);
        let imagePreviewNaturalWidth = 0;
        let imagePreviewNaturalHeight = 0;
        let imagePreviewPointerId: number | null = null;
        let imagePreviewLastPointerX = 0;
        let imagePreviewLastPointerY = 0;
        let imagePreviewDragDistance = 0;
        let imagePreviewDidPan = false;
        let detachPreviewResize: (() => void) | null = null;

        function markPreviewFailure(key: string) {
                if (failedPreviewKeys[key]) {
                        return;
                }

                failedPreviewKeys = { ...failedPreviewKeys, [key]: true };
        }

        function clearVideoPosterFailure(key: string) {
                if (!videoPreviewPosterFailures[key]) {
                        return;
                }

                const next = { ...videoPreviewPosterFailures };
                delete next[key];
                videoPreviewPosterFailures = next;
        }

        function markVideoPosterFailed(key: string) {
                if (videoPreviewPosterFailures[key]) {
                        return;
                }

                videoPreviewPosterFailures = { ...videoPreviewPosterFailures, [key]: true };
        }

        function handleVideoPosterLoad(key: string) {
                clearVideoPosterFailure(key);
        }

        function handleVideoPosterError(key: string) {
                markVideoPosterFailed(key);
        }

        function isVideoAttachmentActive(key: string): boolean {
                return Boolean(activeVideoAttachments[key]);
        }

        function activateVideoAttachment(key: string): void {
                if (activeVideoAttachments[key]) return;
                activeVideoAttachments = { ...activeVideoAttachments, [key]: true };
        }

        function deactivateVideoAttachment(key: string): void {
                if (!activeVideoAttachments[key]) return;
                const next = { ...activeVideoAttachments };
                delete next[key];
                activeVideoAttachments = next;
        }

        function resetImagePreviewTransform() {
                imagePreviewOffsetX = 0;
                imagePreviewOffsetY = 0;
        }

        function attachImagePreviewResize() {
                if (typeof window === 'undefined') return;
                const handleResize = () => {
                        if (!imagePreviewViewport || !imagePreviewNaturalWidth || !imagePreviewNaturalHeight) {
                                return;
                        }
                        const viewport = imagePreviewViewport;
                        const width = viewport.clientWidth;
                        const height = viewport.clientHeight;
                        const scale = Math.min(width / imagePreviewNaturalWidth, height / imagePreviewNaturalHeight, 1);
                        imagePreviewFitZoom = scale;
                        if (!imagePreview) {
                                imagePreviewZoom = scale;
                        }
                };
                window.addEventListener('resize', handleResize);
                detachPreviewResize = () => {
                        window.removeEventListener('resize', handleResize);
                        detachPreviewResize = null;
                };
                handleResize();
        }

        function detachImagePreviewResize() {
                detachPreviewResize?.();
        }

        function openImagePreview(meta: AttachmentMeta) {
                if (meta.kind !== 'image' || !meta.url) return;
                imagePreview = {
                        url: meta.url,
                        title: meta.name,
                        sizeLabel: meta.sizeLabel,
                        contentType: meta.contentType,
                };
                imagePreviewZoom = 1;
                imagePreviewFitZoom = 1;
                imagePreviewOffsetX = 0;
                imagePreviewOffsetY = 0;
                imagePreviewNaturalWidth = 0;
                imagePreviewNaturalHeight = 0;
                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
                attachImagePreviewResize();
        }

        function closeImagePreview() {
                imagePreview = null;
                imagePreviewZoom = 1;
                imagePreviewFitZoom = 1;
                imagePreviewOffsetX = 0;
                imagePreviewOffsetY = 0;
                imagePreviewNaturalWidth = 0;
                imagePreviewNaturalHeight = 0;
                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
                detachImagePreviewResize();
        }

        function setImagePreviewZoom(
                value: number,
                options?: { anchor?: { x: number; y: number }; resetOffset?: boolean }
        ) {
                const fit = imagePreviewFitZoom;
                const minZoom = Math.min(IMAGE_ZOOM_MIN_DEFAULT, fit, 1);
                const clamped = clamp(value, minZoom, IMAGE_ZOOM_MAX);
                if (clamped === imagePreviewZoom) {
                        return;
                }

                if (options?.resetOffset || clamped <= fit + 0.001) {
                        resetImagePreviewTransform();
                } else if (options?.anchor && imagePreviewViewport) {
                        const rect = imagePreviewViewport.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;
                        const offsetX = options.anchor.x - centerX;
                        const offsetY = options.anchor.y - centerY;
                        const ratio = clamped / imagePreviewZoom;
                        imagePreviewOffsetX = imagePreviewOffsetX * ratio + offsetX * (1 - ratio);
                        imagePreviewOffsetY = imagePreviewOffsetY * ratio + offsetY * (1 - ratio);
                } else {
                        const ratio = clamped / imagePreviewZoom;
                        imagePreviewOffsetX = imagePreviewOffsetX * ratio;
                        imagePreviewOffsetY = imagePreviewOffsetY * ratio;
                }

                imagePreviewZoom = clamped;
        }

        function adjustImagePreviewZoom(delta: number, options?: { anchor?: { x: number; y: number } }) {
                setImagePreviewZoom(imagePreviewZoom + delta, options);
        }

        function handlePreviewWheel(event: WheelEvent) {
                if (!imagePreview) return;
                const delta = event.deltaY > 0 ? -IMAGE_ZOOM_STEP : IMAGE_ZOOM_STEP;
                adjustImagePreviewZoom(delta, { anchor: { x: event.clientX, y: event.clientY } });
                event.preventDefault();
        }

        function handlePreviewOverlayClick(event: MouseEvent | PointerEvent) {
                if (event.target instanceof HTMLElement) {
                        const target = event.target;
                        if (target.closest('[data-preview-root]')) {
                                return;
                        }
                }

                closeImagePreview();
        }

        function handleImagePreviewLoad(event: Event) {
                const img = event.currentTarget as HTMLImageElement | null;
                if (!img || !imagePreview) {
                        return;
                }

                imagePreviewNaturalWidth = img.naturalWidth || img.width;
                imagePreviewNaturalHeight = img.naturalHeight || img.height;

                const viewport = imagePreviewViewport;
                if (!viewport) {
                        return;
                }

                const width = viewport.clientWidth;
                const height = viewport.clientHeight;
                const fit = Math.min(
                        width / imagePreviewNaturalWidth,
                        height / imagePreviewNaturalHeight,
                        1
                );
                imagePreviewFitZoom = fit;
                if (imagePreviewZoom <= fit + 0.001) {
                        imagePreviewZoom = fit;
                        resetImagePreviewTransform();
                }
        }

        function handleImagePreviewPointerDown(event: PointerEvent) {
                if (!imagePreview || event.button !== 0) {
                        return;
                }

                imagePreviewPointerId = event.pointerId;
                imagePreviewLastPointerX = event.clientX;
                imagePreviewLastPointerY = event.clientY;
                imagePreviewDragDistance = 0;
                imagePreviewDragging = true;
                imagePreviewDidPan = false;
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }

        function handleImagePreviewPointerMove(event: PointerEvent) {
                if (!imagePreviewDragging || imagePreviewPointerId !== event.pointerId) {
                        return;
                }

                const dx = event.clientX - imagePreviewLastPointerX;
                const dy = event.clientY - imagePreviewLastPointerY;
                imagePreviewLastPointerX = event.clientX;
                imagePreviewLastPointerY = event.clientY;

                const movement = Math.hypot(dx, dy);
                imagePreviewDragDistance += movement;

                const fit = imagePreviewFitZoom;
                if (imagePreviewZoom <= fit + 0.001) {
                        return;
                }

                imagePreviewOffsetX += dx;
                imagePreviewOffsetY += dy;
                if (imagePreviewDragDistance > 3) {
                        imagePreviewDidPan = true;
                }
        }

        function handleImagePreviewPointerUp(event: PointerEvent) {
                if (!imagePreviewDragging || imagePreviewPointerId !== event.pointerId) {
                        return;
                }

                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                const shouldToggleZoom = !imagePreviewDidPan && imagePreviewDragDistance < 4;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;

                (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);

                if (shouldToggleZoom) {
                        const fit = imagePreviewFitZoom;
                        const targetZoom = imagePreviewZoom > fit + 0.001 ? fit : Math.min(IMAGE_ZOOM_MAX, fit * 2);
                        adjustImagePreviewZoom(targetZoom - imagePreviewZoom, {
                                anchor: { x: event.clientX, y: event.clientY },
                        });
                }
        }

        function handleImagePreviewPointerCancel(event: PointerEvent) {
                if (!imagePreviewDragging || imagePreviewPointerId !== event.pointerId) {
                        return;
                }

                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
        }

        function handlePreviewViewportPointerDown(event: PointerEvent) {
                if (!imagePreview) {
                        return;
                }

                if (event.target instanceof HTMLElement) {
                        const isImage = event.target.closest('img[data-preview-image]');
                        if (isImage) {
                                return;
                        }
                }

                setImagePreviewZoom(imagePreviewFitZoom, { resetOffset: true });
        }

        const imagePreviewMinZoom = $derived(Math.min(IMAGE_ZOOM_MIN_DEFAULT, imagePreviewFitZoom, 1));
        const imagePreviewZoomPercent = $derived(Math.round(imagePreviewZoom * 100));

        $effect(() => {
                const list = (attachments ?? []) as MessageAttachment[];
                const keys = new Set(
                        list.map((attachment, index) =>
                                attachmentStableKey(attachment, index, { messageId })
                        )
                );

                const entries = Object.entries(activeVideoAttachments);
                if (entries.length === 0) {
                        return;
                }

                let requiresUpdate = false;
                for (const [key] of entries) {
                        if (!keys.has(key)) {
                                requiresUpdate = true;
                                break;
                        }
                }

                if (!requiresUpdate) return;

                const next: Record<string, boolean> = {};
                for (const [key, value] of entries) {
                        if (keys.has(key)) {
                                next[key] = value;
                        }
                }

                activeVideoAttachments = next;
        });

        $effect(() => {
                if (typeof window === 'undefined') {
                        return;
                }

                const list = (attachments ?? []) as MessageAttachment[];
                const videoKeys = new Set<string>();

                list.forEach((attachment, index) => {
                        const meta = getAttachmentMeta(attachment);
                        if (meta.kind !== 'video' || !meta.url) {
                                return;
                        }
                        const key = attachmentStableKey(attachment, index, { messageId });
                        videoKeys.add(key);
                });

                if (!videoPreviewPosterFailures || !Object.keys(videoPreviewPosterFailures).length) {
                        return;
                }

                const nextFailures = { ...videoPreviewPosterFailures };
                let failuresChanged = false;

                for (const key of Object.keys(nextFailures)) {
                        if (!videoKeys.has(key)) {
                                delete nextFailures[key];
                                failuresChanged = true;
                        }
                }

                if (failuresChanged) {
                        videoPreviewPosterFailures = nextFailures;
                }
        });

        onDestroy(() => {
                detachImagePreviewResize();
        });
</script>

{#if attachmentGroups.length}
        <div class={compact ? 'mt-1 flex flex-col gap-3' : 'mt-1.5 flex flex-col gap-3'}>
                {#each attachmentGroups as group, groupIndex (
                        group.type === 'gallery'
                                ? group.items
                                          .map((item) =>
                                                  attachmentStableKey(item.attachment, item.index, { messageId })
                                          )
                                          .join('|')
                                : attachmentStableKey(group.item.attachment, group.item.index, { messageId })
                )}
                        {#if group.type === 'gallery'}
                                <div
                                        class="grid max-w-[350px] gap-2"
                                        style={galleryGridTemplate(group.items.length)}
                                >
                                        {#each group.items as item, tileIndex (
                                                attachmentStableKey(item.attachment, item.index, { messageId })
                                        )}
                                                {@const tileKey = attachmentStableKey(item.attachment, item.index, { messageId })}
                                                {@const galleryDisplaySrc =
                                                        item.meta.isGif
                                                                ? item.meta.previewUrl ?? GIF_PLACEHOLDER_SRC
                                                                : item.meta.previewUrl ?? item.meta.url}
                                                {@const galleryPreviewFailed = Boolean(failedPreviewKeys[tileKey])}
                                                <div
                                                        class="group relative aspect-square overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                        data-attachment-key={tileKey}
                                                >
                                                        <button
                                                                type="button"
                                                                class="flex h-full w-full cursor-zoom-in items-center justify-center bg-transparent p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                                                onclick={() => openImagePreview(item.meta)}
                                                                data-tooltip-disabled
                                                        >
                                                                <span class="sr-only">{`Open preview for ${item.meta.name}`}</span>
                                                                {#if galleryDisplaySrc && !galleryPreviewFailed}
                                                                        <img
                                                                                src={galleryDisplaySrc}
                                                                                alt={item.meta.name}
                                                                                class="block max-h-full max-w-full select-none object-contain transition group-hover:brightness-110"
                                                                                loading="lazy"
                                                                                onerror={() => markPreviewFailure(tileKey)}
                                                                                use:gifPlayback={{
                                                                                        enabled: item.meta.isGif,
                                                                                        src: item.meta.url,
                                                                                        previewSrc: item.meta.previewUrl,
                                                                                }}
                                                                        />
                                                                {:else}
                                                                        <div
                                                                                class="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--muted)]"
                                                                        >
                                                                                <ImageOff class="h-6 w-6" stroke-width={2} aria-hidden="true" />
                                                                                <span class="font-medium">Preview unavailable</span>
                                                                        </div>
                                                                {/if}
                                                        </button>
                                                        {#if item.meta.url}
                                                                <a
                                                                        class="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 shadow transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/50"
                                                                        href={item.meta.url}
                                                                        download={item.meta.name}
                                                                        rel="noopener noreferrer"
                                                                        onclick={(event) => event.stopPropagation()}
                                                                        aria-label={`Download ${item.meta.name}`}
                                                                >
                                                                        <Download class="h-4 w-4" stroke-width={2} />
                                                                </a>
                                                        {/if}
                                                </div>
                                        {/each}
                                </div>
                        {:else}
                                {@const { attachment, meta, index } = group.item}
                                {@const lowerContentType = meta.contentType?.toLowerCase() ?? null}
                                {@const isAudioAttachment =
                                        meta.kind === 'audio' ||
                                        (lowerContentType?.startsWith('audio/') ?? false)}
                                {#if meta.kind === 'image' && (meta.previewUrl || meta.url)}
                                        {@const previewKey = attachmentStableKey(attachment, index, { messageId })}
                                        {@const displaySrc =
                                                meta.isGif
                                                        ? meta.previewUrl ?? GIF_PLACEHOLDER_SRC
                                                        : meta.previewUrl ?? meta.url}
                                        {@const previewFailed = Boolean(failedPreviewKeys[previewKey])}
                                        {@const imageBounds = computeVisualAttachmentBounds(meta)}
                                        <div
                                                class="group relative inline-flex max-w-full items-center justify-center overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                data-attachment-key={previewKey}
                                                style={visualAttachmentWrapperStyle}
                                                style:width={`${imageBounds.width}px`}
                                                style:height={`${imageBounds.height}px`}
                                        >
                                                <button
                                                        type="button"
                                                        class="flex h-full w-full cursor-zoom-in items-center justify-center bg-transparent p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                                        onclick={() => openImagePreview(meta)}
                                                        data-tooltip-disabled
                                                >
                                                        <span class="sr-only">{`Open preview for ${meta.name}`}</span>
                                                        {#if displaySrc && !previewFailed}
                                                                <img
                                                                        src={displaySrc}
                                                                        alt={meta.name}
                                                                        class="block max-h-full max-w-full select-none object-contain transition group-hover:brightness-110"
                                                                        loading="lazy"
                                                                        style={visualAttachmentMediaStyle}
                                                                        onerror={() => markPreviewFailure(previewKey)}
                                                                        use:gifPlayback={{
                                                                                enabled: meta.isGif,
                                                                                src: meta.url,
                                                                                previewSrc: meta.previewUrl,
                                                                        }}
                                                                />
                                                        {:else}
                                                                <div
                                                                        class="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[var(--muted)]"
                                                                        style={visualAttachmentMediaStyle}
                                                                >
                                                                        <ImageOff class="h-7 w-7" stroke-width={2} aria-hidden="true" />
                                                                        <span class="font-medium">Preview unavailable</span>
                                                                </div>
                                                        {/if}
                                                </button>
                                                {#if meta.url}
                                                        <a
                                                                class="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 shadow transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/50"
                                                                href={meta.url}
                                                                download={meta.name}
                                                                rel="noopener noreferrer"
                                                                onclick={(event) => event.stopPropagation()}
                                                                aria-label={`Download ${meta.name}`}
                                                        >
                                                                <Download class="h-4 w-4" stroke-width={2} />
                                                        </a>
                                                {/if}
                                        </div>
                                {:else if meta.kind === 'video' && meta.url}
                                        {@const attachmentKey = attachmentStableKey(attachment, index, { messageId })}
                                        {@const previewPoster = meta.previewUrl ?? null}
                                        {@const previewPosterFailed = Boolean(videoPreviewPosterFailures[attachmentKey])}
                                        {@const shouldUseFallbackPoster = !previewPoster || previewPosterFailed}
                                        {@const previewFallbackGradient = createVideoFallbackGradient(attachmentKey)}
                                        {@const videoHasExplicitDimensions = meta.aspectRatio != null}
                                        {@const previewAspectRatio =
                                                meta.aspectRatio ?? `${VISUAL_ATTACHMENT_MAX_DIMENSION} / ${VISUAL_ATTACHMENT_MAX_DIMENSION}`}
                                        {@const videoBounds = computeVisualAttachmentBounds(meta)}
                                        {#if isVideoAttachmentActive(attachmentKey)}
                                                <div
                                                        class="group relative inline-flex max-w-full overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                        data-attachment-key={attachmentKey}
                                                        style={visualAttachmentWrapperStyle}
                                                        style:width={`${videoBounds.width}px`}
                                                        style:height={`${videoBounds.height}px`}
                                                >
                                                        <div
                                                                class="relative h-full w-full bg-black"
                                                                style={visualAttachmentMediaStyle}
                                                                style:aspect-ratio={previewAspectRatio}
                                                                style:background-image={shouldUseFallbackPoster
                                                                        ? previewFallbackGradient
                                                                        : undefined}
                                                        >
                                                                <VideoAttachmentPlayer
                                                                        src={meta.url}
                                                                        poster={shouldUseFallbackPoster ? undefined : previewPoster ?? undefined}
                                                                        mediaStyle={`${visualAttachmentMediaStyle} display: block;${videoHasExplicitDimensions ? '' : ' width: 100%; height: 100%;'}`}
                                                                        preload="metadata"
                                                                        playsinline
                                                                        on:close={() => deactivateVideoAttachment(attachmentKey)}
                                                                />
                                                        </div>
                                                </div>
                                        {:else}
                                                <div
                                                        class="group relative inline-flex max-w-full overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                        data-attachment-key={attachmentKey}
                                                        style={visualAttachmentWrapperStyle}
                                                        style:width={`${videoBounds.width}px`}
                                                        style:height={`${videoBounds.height}px`}
                                                >
                                                        <button
                                                                type="button"
                                                                class="flex w-full cursor-pointer flex-col bg-transparent p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                                                onclick={() => activateVideoAttachment(attachmentKey)}
                                                                data-tooltip-disabled
                                                        >
                                                                <span class="sr-only">{`Play video ${meta.name}`}</span>
                                                                <div
                                                                        class="relative h-full w-full overflow-hidden bg-black"
                                                                        style:aspect-ratio={previewAspectRatio}
                                                                        style={visualAttachmentMediaStyle}
                                                                        style:background-image={shouldUseFallbackPoster
                                                                                ? previewFallbackGradient
                                                                                : undefined}
                                                                >
                                                                        {#if previewPoster && !previewPosterFailed}
                                                                                <img
                                                                                        src={previewPoster}
                                                                                        alt={`Preview frame for ${meta.name}`}
                                                                                        class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                                                                                        loading="lazy"
                                                                                        onload={() => handleVideoPosterLoad(attachmentKey)}
                                                                                        onerror={() => handleVideoPosterError(attachmentKey)}
                                                                                />
                                                                                <div class="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/40"></div>
                                                                        {:else}
                                                                                <div
                                                                                        class="absolute inset-0 bg-black"
                                                                                        style:background-image={previewFallbackGradient}
                                                                                ></div>
                                                                        {/if}
                                                                        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-white transition group-hover:bg-black/40">
                                                                                <span class="rounded-full border border-white/60 bg-black/40 p-3">
                                                                                        <Play class="h-6 w-6" stroke-width={2} />
                                                                                </span>
                                                                                <span class="text-sm font-medium">Play video</span>
                                                                        </div>
                                                                </div>
                                                        </button>
                                                        {#if meta.url}
                                                                <a
                                                                        class="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 shadow transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/50"
                                                                        href={meta.url}
                                                                        download={meta.name}
                                                                        rel="noopener noreferrer"
                                                                        onclick={(event) => event.stopPropagation()}
                                                                        aria-label={`Download ${meta.name}`}
                                                                >
                                                                        <Download class="h-4 w-4" stroke-width={2} />
                                                                </a>
                                                        {/if}
                                                </div>
                                        {/if}
                                {:else if meta.url && isAudioAttachment}
                                        {@const audioAttachmentKey = attachmentStableKey(attachment, index, { messageId })}
                                        <div data-attachment-key={audioAttachmentKey} class="inline-flex">
                                                <AudioAttachmentPlayer
                                                        preload="metadata"
                                                        src={meta.url}
                                                        name={meta.name ?? undefined}
                                                        sizeLabel={meta.sizeLabel ?? undefined}
                                                />
                                        </div>
                                {:else}
                                        <a
                                                class="flex max-w-[18rem] items-center gap-2 rounded border border-[var(--stroke)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]"
                                                data-attachment-key={attachmentStableKey(attachment, index, { messageId })}
                                                href={meta.url ?? undefined}
                                                rel={meta.url ? 'noopener noreferrer' : undefined}
                                                target={meta.url ? '_blank' : undefined}
                                        >
                                                <Paperclip class="h-3.5 w-3.5 text-[var(--muted)]" stroke-width={2} />
                                                <span class="truncate">
                                                        {meta.name}
                                                </span>
                                                {#if meta.sizeLabel}
                                                        <span class="ml-auto whitespace-nowrap text-[var(--muted)]">
                                                                {meta.sizeLabel}
                                                        </span>
                                                {/if}
                                        </a>
                                {/if}
                        {/if}
                {/each}
        </div>
{/if}

{#if imagePreview}
        <div
                class="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm"
                onpointerdown={handlePreviewOverlayClick}
        >
                <div class="border-b border-white/10 px-6 py-4 text-white" data-preview-root>
                        <div class="flex items-start justify-between gap-4">
                                <div class="min-w-0">
                                        <div class="truncate text-base font-semibold">{imagePreview.title}</div>
                                        <div class="mt-1 flex flex-wrap gap-3 text-xs text-white/70">
                                                {#if imagePreview.sizeLabel}
                                                        <span>{imagePreview.sizeLabel}</span>
                                                {/if}
                                                {#if imagePreview.contentType}
                                                        <span>{imagePreview.contentType}</span>
                                                {/if}
                                        </div>
                                </div>
                                <div class="flex items-center gap-2 text-sm">
                                        <a
                                                class="rounded border border-white/30 px-3 py-1 text-white/90 transition hover:bg-white/10"
                                                href={imagePreview.url}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                        >
                                                Open original
                                        </a>
                                        <button
                                                class="rounded border border-white/30 px-3 py-1 text-white/90 transition hover:bg-white/10"
                                                type="button"
                                                onclick={closeImagePreview}
                                        >
                                                Close
                                        </button>
                                </div>
                        </div>
                        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/80">
                                <button
                                        class="rounded border border-white/30 px-2 py-1 transition hover:bg-white/10"
                                        type="button"
                                        onclick={() => adjustImagePreviewZoom(-IMAGE_ZOOM_STEP)}
                                >
                                        −
                                </button>
                                <input
                                        type="range"
                                        min={imagePreviewMinZoom}
                                        max={IMAGE_ZOOM_MAX}
                                        step={IMAGE_ZOOM_STEP}
                                        value={imagePreviewZoom}
                                        oninput={(event) =>
                                                setImagePreviewZoom(
                                                        Number((event.currentTarget as HTMLInputElement).value)
                                                )
                                        }
                                        class="h-1 w-32 cursor-pointer accent-[var(--brand)]"
                                />
                                <button
                                        class="rounded border border-white/30 px-2 py-1 transition hover:bg-white/10"
                                        type="button"
                                        onclick={() => adjustImagePreviewZoom(IMAGE_ZOOM_STEP)}
                                >
                                        +
                                </button>
                                <span class="w-12 text-center text-white/90">{imagePreviewZoomPercent}%</span>
                                <button
                                        class="rounded border border-white/30 px-3 py-1 text-white/90 transition hover:bg-white/10"
                                        type="button"
                                        onclick={() =>
                                                setImagePreviewZoom(imagePreviewFitZoom, { resetOffset: true })
                                        }
                                >
                                        Reset
                                </button>
                        </div>
                </div>
                <div
                        class="flex-1 overflow-hidden"
                        bind:this={imagePreviewViewport}
                        onwheel={handlePreviewWheel}
                >
                        <div
                                class="flex h-full w-full items-center justify-center p-6"
                                onpointerdown={handlePreviewViewportPointerDown}
                        >
                                <img
                                        src={imagePreview.url}
                                        alt={imagePreview.title}
                                        class={`max-h-none max-w-none select-none shadow-2xl transition-transform duration-100 ${
                                                imagePreviewDragging ? 'cursor-grabbing' : 'cursor-grab'
                                        }`}
                                        style={`transform: translate(${imagePreviewOffsetX}px, ${imagePreviewOffsetY}px) scale(${imagePreviewZoom}); transform-origin: center center;`}
                                        draggable="false"
                                        onload={handleImagePreviewLoad}
                                        onpointerdown={handleImagePreviewPointerDown}
                                        onpointermove={handleImagePreviewPointerMove}
                                        onpointerup={handleImagePreviewPointerUp}
                                        onpointercancel={handleImagePreviewPointerCancel}
                                        data-preview-image
                                />
                        </div>
                </div>
        </div>
{/if}
