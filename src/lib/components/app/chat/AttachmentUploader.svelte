<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedChannelId } from '$lib/stores/appState';
        import { createEventDispatcher } from 'svelte';
        import { AlertOctagon, LoaderCircle, Paperclip, X } from 'lucide-svelte';
        import { tooltip } from '$lib/actions/tooltip';
        import type { PendingAttachment } from '$lib/stores/pendingMessages';

        let { attachments, inline = false } = $props<{
                attachments: PendingAttachment[];
                inline?: boolean;
        }>();
	let loading = $state(false);
        let error: string | null = $state(null);
        let errorAnimationKey = $state(0);

        $effect(() => {
                if (error) {
                        errorAnimationKey += 1;
                }
        });

        $effect(() => {
                if (!error) {
                        return;
                }

                if (typeof window === 'undefined') {
                        return;
                }

                const handleKeydown = (event: KeyboardEvent) => {
                        if (event.key === 'Escape') {
                                event.preventDefault();
                                error = null;
                        }
                };

                window.addEventListener('keydown', handleKeydown);
                return () => {
                        window.removeEventListener('keydown', handleKeydown);
                };
        });
        const dispatch = createEventDispatcher<{ updated: PendingAttachment[] }>();

        function toFileArray(input: FileList | File[] | null | undefined): File[] {
                if (!input) return [];
                return Array.from(input as FileList | File[]);
        }

        export async function addFiles(
                filesInput: FileList | File[] | null | undefined
        ): Promise<PendingAttachment[] | void> {
                const files = toFileArray(filesInput);
                const selected = $selectedChannelId;
                if (!files.length || !selected) return [];

                let channelSnowflake: bigint;
                try {
                        channelSnowflake = BigInt(selected);
                } catch (err) {
                        error = 'Invalid channel selected';
                        return [];
                }

                loading = true;
                error = null;

                const placeholders: PendingAttachment[] = files.map((file) => ({
                        localId: createLocalId(),
                        attachmentId: null,
                        file,
                        filename: file.name,
                        size: file.size,
                        mimeType: file.type || 'application/octet-stream',
                        width: undefined,
                        height: undefined,
                        previewUrl: createPreviewUrl(file),
                        isImage: file.type.startsWith('image/'),
                        status: 'queued',
                        progress: 0,
                        uploadedBytes: 0,
                        error: null
                }));

                if (placeholders.length) {
                        dispatch('updated', placeholders);
                }

                const successful: PendingAttachment[] = [];

                try {
                        for (const placeholder of placeholders) {
                                try {
                                        const meta = await getFileMeta(placeholder.file);
                                        const res = await auth.api.message.messageChannelChannelIdAttachmentPost({
                                                channelId: channelSnowflake as any,
                                                messageUploadAttachmentRequest: {
                                                        filename: placeholder.filename,
                                                        content_type: placeholder.mimeType,
                                                        file_size: placeholder.size,
                                                        width: meta.width ?? undefined,
                                                        height: meta.height ?? undefined
                                                }
                                        });
                                        const data = res.data as {
                                                id?: string | number | bigint;
                                                attachment_id?: string | number | bigint;
                                                attachmentId?: string | number | bigint;
                                                upload_url?: string | null;
                                                uploadUrl?: string | null;
                                                upload_headers?: unknown;
                                                uploadHeaders?: unknown;
                                                headers?: unknown;
                                        };
                                        const rawId =
                                                data.id ?? data.attachment_id ?? data.attachmentId;
                                        if (rawId == null) {
                                                error = 'Attachment response missing id';
                                                dispatch('updated', [
                                                        {
                                                                ...placeholder,
                                                                status: 'error',
                                                                error: 'Attachment response missing id'
                                                        }
                                                ]);
                                                continue;
                                        }

                                        let snowflake: bigint;
                                        try {
                                                snowflake =
                                                        typeof rawId === 'bigint'
                                                                ? rawId
                                                                : BigInt(rawId);
                                        } catch {
                                                error = 'Attachment response malformed';
                                                dispatch('updated', [
                                                        {
                                                                ...placeholder,
                                                                status: 'error',
                                                                error: 'Attachment response malformed'
                                                        }
                                                ]);
                                                continue;
                                        }

                                        const updated: PendingAttachment = {
                                                ...placeholder,
                                                attachmentId: snowflake,
                                                width: meta.width ?? placeholder.width,
                                                height: meta.height ?? placeholder.height,
                                                error: null
                                        };

                                        successful.push(updated);
                                        dispatch('updated', [updated]);
                                } catch (e) {
                                        const err = e as {
                                                response?: { status?: number; data?: { message?: string } };
                                                message?: string;
                                        };
                                        const statusCode = err.response?.status;
                                        const message =
                                                statusCode === 413
                                                        ? 'File size is too big'
                                                        : err.response?.data?.message ?? err.message ?? 'Attachment failed';
                                        error = message;
                                        dispatch('updated', [
                                                {
                                                        ...placeholder,
                                                        status: 'error',
                                                        error: message
                                                }
                                        ]);
                                }
                        }
                } finally {
                        loading = false;
                }

                return successful;
        }

        async function pickFiles(e: Event) {
                const target = e.target as HTMLInputElement | { files: FileList | null };
                try {
                        await addFiles(target.files ?? null);
                } finally {
                        if ('value' in target) {
                                target.value = '';
                        }
                }
        }

        function getFileMeta(file: File): Promise<{ width?: number; height?: number }> {
                return new Promise((resolve) => {
                        const type = file.type || '';
                        if (!type.startsWith('image/') && !type.startsWith('video/')) {
                                resolve({});
                                return;
                        }

                        const url = safeCreateObjectUrl(file);
                        if (!url) {
                                resolve({});
                                return;
                        }

                        if (type.startsWith('image/')) {
                                const img = new Image();
                                const cleanup = () => {
                                        URL.revokeObjectURL(url);
                                };
                                img.onload = () => {
                                        const width = img.naturalWidth || img.width || 0;
                                        const height = img.naturalHeight || img.height || 0;
                                        cleanup();
                                        resolve(width > 0 && height > 0 ? { width, height } : {});
                                };
                                img.onerror = () => {
                                        cleanup();
                                        resolve({});
                                };
                                img.src = url;
                                return;
                        }

                        const video = document.createElement('video');
                        let settled = false;
                        const cleanup = () => {
                                video.removeEventListener('loadedmetadata', handleLoadedMetadata);
                                video.removeEventListener('error', handleError);
                                try {
                                        video.pause();
                                } catch {
                                        // noop
                                }
                                video.src = '';
                                video.removeAttribute('src');
                                try {
                                        video.load();
                                } catch {
                                        // noop
                                }
                                URL.revokeObjectURL(url);
                        };

                        const finalize = (width?: number, height?: number) => {
                                if (settled) {
                                        return;
                                }
                                settled = true;
                                cleanup();
                                if (width && height && width > 0 && height > 0) {
                                        resolve({ width, height });
                                } else {
                                        resolve({});
                                }
                        };

                        const handleLoadedMetadata = () => {
                                const width = video.videoWidth || video.width;
                                const height = video.videoHeight || video.height;
                                finalize(width, height);
                        };

                        const handleError = () => finalize();

                        video.preload = 'metadata';
                        video.muted = true;
                        video.playsInline = true;
                        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
                        video.addEventListener('error', handleError, { once: true });
                        video.src = url;
                        try {
                                video.load();
                        } catch {
                                // noop
                        }
                });
        }

        function safeCreateObjectUrl(file: File): string | null {
                try {
                        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                                return URL.createObjectURL(file);
                        }
                        return null;
                } catch {
                        return null;
                }
        }

        function createPreviewUrl(file: File): string | null {
                const url = safeCreateObjectUrl(file);
                if (!url) return null;
                return url;
        }

        function createLocalId(): string {
                if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                        return crypto.randomUUID();
                }
                return `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }
</script>

<div class="flex flex-col gap-1">
        <div
                class="flex items-center gap-2"
                role="button"
                tabindex="0"
                ondragover={(e: DragEvent) => e.preventDefault()}
                ondrop={(e: DragEvent) => {
                        e.preventDefault();
                        const dt = e.dataTransfer;
                        if (!dt) return;
                        const files = dt.files;
                        if (files && files.length) {
                                const inputLike: Pick<HTMLInputElement, 'files'> = { files };
                                pickFiles({ target: inputLike } as unknown as Event);
                        }
                }}
        >
                <label
                        class={inline
                                ? 'grid h-8 w-8 cursor-pointer place-items-center rounded-md hover:bg-[var(--panel)]'
                                : 'cursor-pointer rounded-md border border-[var(--stroke)] px-2 py-1'}
                        use:tooltip={() => (loading ? 'Uploading…' : 'Attach files')}
                >
                        <input type="file" class="hidden" multiple onchange={pickFiles} />
                        {#if inline}
                                {#if loading}
                                        <LoaderCircle class="h-[18px] w-[18px] animate-spin" stroke-width={2} />
                                {:else}
                                        <Paperclip class="h-[18px] w-[18px]" stroke-width={2} />
                                {/if}
                        {:else}
                                {loading ? 'Uploading…' : 'Attach'}
                        {/if}
                </label>
                {#if !inline && attachments.length}
                        <span class="text-xs text-[var(--muted)]">{attachments.length} attachment(s)</span>
                {/if}
        </div>
        {#if error}
                <div
                        class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 px-4"
                        role="presentation"
                        onclick={() => (error = null)}
                >
                        {@const modalLabelId = `attachment-error-title-${errorAnimationKey}`}
                        {@const modalDescriptionId = `attachment-error-description-${errorAnimationKey}`}
                        <div
                                class="pointer-events-auto w-full max-w-sm"
                                role="alertdialog"
                                aria-modal="true"
                                aria-labelledby={modalLabelId}
                                aria-describedby={modalDescriptionId}
                                tabindex="0"
                                onclick={(event) => event.stopPropagation()}
                                onkeydown={(event) => {
                                        if (event.key === 'Escape') {
                                                event.stopPropagation();
                                                error = null;
                                        }
                                }}
                        >
                                {@key errorAnimationKey}
                                        <div class="rounded-lg backdrop-blur-md shadow-[var(--shadow-3)]">
                                                <div class="panel flex items-start gap-4 rounded-md p-5 attachment-error-animate">
                                                        <div class="mt-1 rounded-full bg-red-500/15 p-2 text-red-400">
                                                                <AlertOctagon class="h-6 w-6" aria-hidden="true" />
                                                        </div>
                                                        <div class="flex-1 space-y-2">
                                                                <div class="text-lg font-semibold" id={modalLabelId}>
                                                                        Upload error
                                                                </div>
                                                                <p class="text-sm text-[var(--muted)]" id={modalDescriptionId}>
                                                                        {error}
                                                                </p>
                                                        </div>
                                                        <button
                                                                type="button"
                                                                class="rounded-full p-1 text-[var(--muted)] transition hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                                                aria-label="Dismiss attachment error"
                                                                onclick={() => (error = null)}
                                                        >
                                                                <X class="h-4 w-4" aria-hidden="true" />
                                                        </button>
                                                </div>
                                        </div>
                        </div>
                </div>
        {/if}
</div>

<style>
        @keyframes attachment-error-shake {
                0%,
                100% {
                        transform: translateX(0);
                }

                15%,
                45%,
                75% {
                        transform: translateX(-6px);
                }

                30%,
                60%,
                90% {
                        transform: translateX(6px);
                }
        }

        .attachment-error-animate {
                animation: attachment-error-shake 1s ease both;
        }
</style>
