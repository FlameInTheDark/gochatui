<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedChannelId } from '$lib/stores/appState';
        import { createEventDispatcher } from 'svelte';
        import { LoaderCircle, Paperclip } from 'lucide-svelte';
        import { tooltip } from '$lib/actions/tooltip';
        import type { PendingAttachment } from '$lib/stores/pendingMessages';

        let { attachments, inline = false } = $props<{
                attachments: PendingAttachment[];
                inline?: boolean;
        }>();
	let loading = $state(false);
	let error: string | null = $state(null);
	const dispatch = createEventDispatcher<{ updated: void }>();

        function normalizeUploadHeaders(input: unknown): Record<string, string> {
                if (!input || typeof input !== 'object') {
                        return {};
                }

                const entries: Array<[string, string]> = [];
                const pushEntry = (key: unknown, value: unknown) => {
                        if (typeof key !== 'string') return;
                        const trimmedKey = key.trim();
                        if (!trimmedKey) return;
                        if (value == null) return;
                        let normalizedValue: string | null = null;
                        if (typeof value === 'string') {
                                normalizedValue = value;
                        } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
                                normalizedValue = value.toString();
                        } else if (Array.isArray(value)) {
                                normalizedValue = value.filter((item) => item != null).map((item) => String(item)).join(', ');
                        } else if (typeof value === 'object') {
                                const maybeValue =
                                        (value as Record<string, unknown>).value ??
                                        (value as Record<string, unknown>).val ??
                                        (value as Record<string, unknown>).headerValue;
                                if (maybeValue != null) {
                                        normalizedValue = String(maybeValue);
                                }
                        }

                        if (normalizedValue == null) return;
                        entries.push([trimmedKey, normalizedValue]);
                };

                if (Array.isArray(input)) {
                        for (const item of input) {
                                if (!item) continue;
                                if (Array.isArray(item) && item.length >= 2) {
                                        pushEntry(item[0], item[1]);
                                        continue;
                                }
                                if (typeof item === 'object') {
                                        const record = item as Record<string, unknown>;
                                        const key = record.name ?? record.key ?? record.header ?? record.headerName;
                                        const value =
                                                record.value ??
                                                record.val ??
                                                record.headerValue ??
                                                (Array.isArray(record.values) ? record.values.join(', ') : undefined);
                                        pushEntry(typeof key === 'string' ? key : '', value);
                                }
                        }
                } else {
                        for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
                                pushEntry(key, value);
                        }
                }

                return Object.fromEntries(entries);
        }

        function toFileArray(input: FileList | File[] | null | undefined): File[] {
                if (!input) return [];
                return Array.from(input as FileList | File[]);
        }

        export async function addFiles(filesInput: FileList | File[] | null | undefined) {
                const files = toFileArray(filesInput);
                const selected = $selectedChannelId;
                if (!files.length || !selected) return;

                let channelSnowflake: bigint;
                try {
                        channelSnowflake = BigInt(selected);
                } catch (err) {
                        error = 'Invalid channel selected';
                        return;
                }

                loading = true;
                error = null;
                try {
                        for (const file of files) {
                                const meta = await getFileMeta(file);
                                const res = await auth.api.message.messageChannelChannelIdAttachmentPost({
                                        channelId: channelSnowflake as any,
                                        messageUploadAttachmentRequest: {
                                                filename: file.name,
                                                content_type: file.type || 'application/octet-stream',
                                                file_size: file.size,
                                                width: meta.width ?? undefined,
                                                height: meta.height ?? undefined
                                        }
                                });
                                const data = res.data as {
                                        id?: string | number | bigint;
                                        attachment_id?: string | number | bigint;
                                        upload_url?: string | null;
                                        upload_headers?: unknown;
                                        headers?: unknown;
                                };
                                const rawId = data.id ?? data.attachment_id;
                                if (rawId == null) {
                                        error = 'Attachment response missing id';
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
                                        continue;
                                }

                                const uploadUrl = typeof data.upload_url === 'string' ? data.upload_url : null;
                                if (!uploadUrl) {
                                        error = 'Attachment response missing upload URL';
                                        continue;
                                }

                                const uploadHeaders = normalizeUploadHeaders(data.upload_headers ?? data.headers);

                                const previewUrl = createPreviewUrl(file);
                                const localId = createLocalId();
                                attachments.push({
                                        localId,
                                        attachmentId: snowflake,
                                        uploadUrl,
                                        uploadHeaders,
                                        file,
                                        filename: file.name,
                                        size: file.size,
                                        mimeType: file.type || 'application/octet-stream',
                                        width: meta.width ?? undefined,
                                        height: meta.height ?? undefined,
                                        previewUrl,
                                        isImage: file.type.startsWith('image/'),
                                        status: 'queued',
                                        progress: 0,
                                        uploadedBytes: 0,
                                        error: null
                                });
                                // notify parent for re-render/bindings
                                dispatch('updated');
                        }
                } catch (e) {
                        const err = e as {
                                response?: { data?: { message?: string } };
                                message?: string;
                        };
                        error = err.response?.data?.message ?? err.message ?? 'Attachment failed';
                } finally {
                        loading = false;
                }
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
	{#if !inline}
		{#if error}<span class="text-xs text-red-400">{error}</span>{/if}
		{#if attachments.length}
			<span class="text-xs text-[var(--muted)]">{attachments.length} attachment(s)</span>
		{/if}
	{/if}
</div>
