<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedChannelId, selectedGuildId, channelsByGuild } from '$lib/stores/appState';
        import AttachmentUploader from './AttachmentUploader.svelte';
        import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
        import { get } from 'svelte/store';
        import { m } from '$lib/paraglide/messages.js';
        import { Send, X, Paperclip } from 'lucide-svelte';
        import {
                addPendingMessage,
                removePendingMessage,
                updatePendingAttachment,
                updatePendingMessage,
                type PendingAttachment,
                type PendingMessage
        } from '$lib/stores/pendingMessages';
        import { computeApiBase } from '$lib/runtime/api';

        let content = $state('');
        let attachments = $state<PendingAttachment[]>([]);
        let sending = $state(false);
        const dispatch = createEventDispatcher<{ sent: void }>();

        let ta: HTMLTextAreaElement | null = null;
        let uploaderRef:
                | {
                          addFiles?: (
                                  files: FileList | File[] | null | undefined
                          ) => Promise<PendingAttachment[] | void>;
                  }
                | null = null;
        let dropActive = $state(false);
        let dragCounter = $state(0);
        let removeGlobalDragListeners: (() => void) | null = null;

        const TYPING_RENEWAL_INTERVAL_MS = 10_000;
        let typingResetTimer: ReturnType<typeof setTimeout> | null = null;
        let typingLastSentAt = 0;
        let typingActive = false;
        let typingChannelId: string | null = null;

        function hasFileTransfer(event: DragEvent): boolean {
                const dt = event.dataTransfer;
                if (!dt) return false;
                if (dt.files && dt.files.length > 0) return true;
                const types = dt.types ? Array.from(dt.types) : [];
                return types.includes('Files');
        }

        function mergeAttachments(added: readonly PendingAttachment[] | null | undefined) {
                if (!added || added.length === 0) {
                        return;
                }

                const next: PendingAttachment[] = attachments.slice();

                for (const incoming of added) {
                        const index = next.findIndex((attachment) => attachment.localId === incoming.localId);
                        const isOversizeError =
                                incoming.status === 'error' && incoming.error === 'File size is too big';

                        if (isOversizeError) {
                                if (index !== -1) {
                                        const [removed] = next.splice(index, 1);
                                        if (removed) {
                                                releasePreviewUrl(removed);
                                        }
                                }
                                continue;
                        }

                        if (index !== -1) {
                                const previous = next[index];
                                if (previous.previewUrl && previous.previewUrl !== incoming.previewUrl) {
                                        releasePreviewUrl(previous);
                                }
                                next[index] = incoming;
                                continue;
                        }

                        next.push(incoming);
                }

                attachments = next;
        }

        async function handleDroppedFiles(files: FileList | null | undefined) {
                if (!files || files.length === 0) return;
                if (!uploaderRef?.addFiles) return;
                try {
                        const added = await uploaderRef.addFiles(files);
                        mergeAttachments(added ?? []);
                } catch (err) {
                        console.error('Failed to add dropped files', err);
                }
        }

        function handleDragEnter(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                dragCounter += 1;
                dropActive = true;
        }

        function handleDragOver(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = 'copy';
                }
        }

        function handleDragLeave(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                dragCounter = Math.max(0, dragCounter - 1);
                if (dragCounter === 0) {
                        dropActive = false;
                }
        }

        function handleDragEnd(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                dragCounter = 0;
                dropActive = false;
        }

        async function handleDrop(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                dragCounter = 0;
                dropActive = false;
                await handleDroppedFiles(event.dataTransfer?.files ?? null);
                event.dataTransfer?.clearData();
        }

        function clearTypingTimer() {
                if (typingResetTimer) {
                        clearTimeout(typingResetTimer);
                        typingResetTimer = null;
                }
        }

        function resetTypingState() {
                typingActive = false;
                typingLastSentAt = 0;
                typingChannelId = null;
                clearTypingTimer();
        }

        async function postTypingIndicator(channelId: string) {
                const messageApi = auth.api.message;
                if (!messageApi?.messageChannelChannelIdTypingPost) {
                        return;
                }
                await messageApi.messageChannelChannelIdTypingPost({
                        channelId: channelId as any
                });
        }

        async function dispatchTypingIndicator(channelId: string) {
                typingChannelId = channelId;
                typingActive = true;
                typingLastSentAt = Date.now();
                clearTypingTimer();
                typingResetTimer = setTimeout(() => {
                        typingActive = false;
                        typingResetTimer = null;
                }, TYPING_RENEWAL_INTERVAL_MS);
                try {
                        await postTypingIndicator(channelId);
                } catch (error) {
                        console.debug('Failed to send typing indicator', error);
                }
        }

        function handleTypingActivity(value: string) {
                const trimmed = value.trim();
                if (!trimmed) {
                        resetTypingState();
                        return;
                }
                const channelId = $selectedChannelId;
                if (!channelId) {
                        return;
                }
                const now = Date.now();
                const shouldSend =
                        !typingActive ||
                        channelId !== typingChannelId ||
                        now - typingLastSentAt >= TYPING_RENEWAL_INTERVAL_MS;
                if (shouldSend) {
                        void dispatchTypingIndicator(channelId);
                }
        }

        const VISUAL_ATTACHMENT_PREVIEW_SIZE = 218;
        const visualAttachmentWrapperStyle = `width: min(100%, ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px); max-width: min(100%, ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px);`;
        const visualAttachmentMediaStyle = `width: 100%; height: ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px; object-fit: contain;`;
        const visualAttachmentPlaceholderStyle = `height: ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px;`;

	// Derive current channel name to show in placeholder
	function currentChannel() {
		const gid = $selectedGuildId ?? '';
		return ($channelsByGuild[gid] ?? []).find((c) => String((c as any).id) === $selectedChannelId);
	}
	function channelName() {
		const ch = currentChannel() as any;
		return (ch?.name ?? '').toString();
	}

        function autoResize() {
                if (!ta) return;
                ta.style.height = 'auto';
                const max = Math.floor((window?.innerHeight || 800) * 0.4);
                const next = Math.min(ta.scrollHeight, max);
                ta.style.height = next + 'px';
                ta.style.overflowY = ta.scrollHeight > next ? 'auto' : 'hidden';
        }

        function handleInput(event: Event) {
                autoResize();
                const target = event.currentTarget as HTMLTextAreaElement | null;
                const value = target?.value ?? '';
                handleTypingActivity(value);
        }

        onMount(() => {
                autoResize();

                if (typeof window === 'undefined') {
                        return;
                }

                const win = window;
                const listeners: Array<[keyof WindowEventMap, (event: DragEvent) => void]> = [
                        ['dragenter', handleDragEnter],
                        ['dragover', handleDragOver],
                        ['dragleave', handleDragLeave],
                        ['drop', handleDrop],
                        ['dragend', handleDragEnd]
                ];
                const opts: boolean = true;
                listeners.forEach(([event, handler]) => {
                        win.addEventListener(event, handler as EventListener, opts);
                });
                removeGlobalDragListeners = () => {
                        listeners.forEach(([event, handler]) => {
                                win.removeEventListener(event, handler as EventListener, opts);
                        });
                };
        });

        onDestroy(() => {
                clearLocalAttachments({ releasePreviews: true });
                if (removeGlobalDragListeners) {
                        removeGlobalDragListeners();
                        removeGlobalDragListeners = null;
                }
                resetTypingState();
        });

        $effect(() => {
                const channelId = $selectedChannelId;
                if (channelId !== typingChannelId) {
                        resetTypingState();
                        typingChannelId = channelId ?? null;
                }
        });

        function releasePreviewUrl(attachment: PendingAttachment | undefined) {
                if (!attachment?.previewUrl) return;
                if (!attachment.previewUrl.startsWith('blob:')) return;
                try {
                        URL.revokeObjectURL(attachment.previewUrl);
                } catch {
                        /* ignore */
                }
        }

        function clearLocalAttachments(options?: { releasePreviews?: boolean }) {
                const shouldRelease = options?.releasePreviews ?? false;
                if (shouldRelease) {
                        for (const attachment of attachments) {
                                releasePreviewUrl(attachment);
                        }
                }
                attachments = [];
        }

        function removeAttachment(localId: string) {
                const index = attachments.findIndex((attachment) => attachment.localId === localId);
                if (index === -1) return;
                const [removed] = attachments.splice(index, 1);
                attachments = [...attachments];
                releasePreviewUrl(removed);
        }

        function createLocalMessageId(): string {
                if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                        return crypto.randomUUID();
                }
                return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }

        function cloneAttachmentForSend(attachment: PendingAttachment): PendingAttachment {
                let previewUrl = attachment.previewUrl;
                if (previewUrl && previewUrl.startsWith('blob:')) {
                        try {
                                previewUrl = URL.createObjectURL(attachment.file);
                        } catch {
                                previewUrl = attachment.previewUrl;
                        }
                }
                return {
                        ...attachment,
                        previewUrl,
                        status: 'queued',
                        progress: 0,
                        uploadedBytes: 0,
                        error: null
                };
        }

        async function send() {
                const channelId = $selectedChannelId;
                const trimmedContent = content.trim();
                if (!channelId || (!trimmedContent && attachments.length === 0)) return;
                sending = true;

                const localMessageId = createLocalMessageId();
                const attachmentsForSend = attachments.map(cloneAttachmentForSend);
                const pendingMessage: PendingMessage = {
                        localId: localMessageId,
                        channelId,
                        content: trimmedContent,
                        createdAt: new Date(),
                        attachments: attachmentsForSend,
                        status: 'pending',
                        error: null
                };

                addPendingMessage(pendingMessage);

                content = '';
                resetTypingState();
                typingChannelId = $selectedChannelId ?? null;
                clearLocalAttachments({ releasePreviews: true });
                // wait for DOM to reflect cleared content, then collapse height
                await tick();
                if (ta) {
                        ta.style.height = 'auto';
                        ta.style.overflowY = 'hidden';
                }
                dispatch('sent');
                sending = false;

                await processPendingMessage(pendingMessage);
        }

        function getErrorMessage(err: unknown): string {
                const error = err as { response?: { data?: { message?: string } }; message?: string };
                return error.response?.data?.message ?? error.message ?? 'Failed to send message';
        }

        async function uploadAttachmentWithProgress(
                channelId: bigint,
                attachment: PendingAttachment,
                onProgress: (uploaded: number, total: number) => void
        ) {
                if (!attachment.attachmentId) {
                        throw new Error('Missing attachment id');
                }

                const totalBytes = attachment.file.size || 0;

                await auth.api.upload.uploadAttachmentsChannelIdAttachmentIdPost(
                        {
                                channelId: channelId as any,
                                attachmentId: attachment.attachmentId as any,
                                requestBody: attachment.file as any
                        },
                        {
                                headers: {
                                        'Content-Type': attachment.mimeType || 'application/octet-stream'
                                },
                                onUploadProgress: (event) => {
                                        const uploaded = typeof event.loaded === 'number' ? event.loaded : 0;
                                        const total =
                                                typeof event.total === 'number' && event.total > 0
                                                        ? event.total
                                                        : totalBytes;
                                        onProgress(uploaded, total > 0 ? total : totalBytes);
                                }
                        }
                );
        }

        async function processPendingMessage(message: PendingMessage) {
                const { localId, attachments: pendingAttachments, content: messageContent, channelId } = message;
                const successfulIds: bigint[] = [];

                let channelSnowflake: bigint;
                try {
                        channelSnowflake = BigInt(channelId);
                } catch {
                        updatePendingMessage(localId, (current) => ({
                                ...current,
                                status: 'error',
                                error: 'Invalid channel id'
                        }));
                        return;
                }

                for (const attachment of pendingAttachments) {
                        if (attachment.attachmentId == null) {
                                updatePendingAttachment(localId, attachment.localId, () => ({
                                        ...attachment,
                                        status: 'error',
                                        progress: 0,
                                        uploadedBytes: 0,
                                        error: 'Missing attachment metadata'
                                }));
                                continue;
                        }

                        updatePendingAttachment(localId, attachment.localId, () => ({
                                ...attachment,
                                status: 'uploading',
                                progress: 0,
                                uploadedBytes: 0,
                                error: null
                        }));

                        try {
                                await uploadAttachmentWithProgress(
                                        channelSnowflake,
                                        attachment,
                                        (uploaded, total) => {
                                                updatePendingAttachment(localId, attachment.localId, (current) => {
                                                        const fallbackTotal = current.size > 0 ? current.size : total;
                                                        const denominator = total > 0 ? total : fallbackTotal;
                                                        const ratio = denominator > 0 ? Math.min(1, uploaded / denominator) : 1;
                                                        return {
                                                                ...current,
                                                                uploadedBytes: denominator > 0 ? Math.min(uploaded, denominator) : uploaded,
                                                                progress: ratio
                                                        };
                                                });
                                        }
                                );
                                successfulIds.push(attachment.attachmentId);
                                updatePendingAttachment(localId, attachment.localId, (current) => ({
                                        ...current,
                                        status: 'success',
                                        progress: 1,
                                        uploadedBytes: current.size,
                                        error: null
                                }));
                        } catch (err) {
                                const message = getErrorMessage(err);
                                updatePendingAttachment(localId, attachment.localId, (current) => ({
                                        ...current,
                                        status: 'error',
                                        error: message,
                                        progress: current.progress,
                                        uploadedBytes: current.uploadedBytes
                                }));
                        }
                }

                if (!messageContent && successfulIds.length === 0) {
                        updatePendingMessage(localId, (current) => ({
                                ...current,
                                status: 'error',
                                error: 'All attachments failed to upload'
                        }));
                        return;
                }

                try {
                        await auth.api.message.messageChannelChannelIdPost({
                                channelId: channelId as any,
                                messageSendMessageRequest: {
                                        content: messageContent,
                                        attachments: successfulIds as any
                                }
                        });
                        removePendingMessage(localId);
                } catch (err) {
                        const messageText = getErrorMessage(err);
                        updatePendingMessage(localId, (current) => ({
                                ...current,
                                status: 'error',
                                error: messageText
                        }));
                }
        }
</script>

<div class="relative border-t border-[var(--stroke)] p-3">
        {#if dropActive}
                <div
                        class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[var(--brand)]/70 bg-[var(--panel-strong)]/80 text-center text-sm font-semibold text-[var(--fg)]"
                >
                        <Paperclip class="h-5 w-5" stroke-width={2} />
                        <span>{m.chat_drop_to_attach()}</span>
                </div>
        {/if}
        {#if attachments.length}
                <div class="mb-3 flex flex-wrap gap-3">
                        {#each attachments as attachment (attachment.localId)}
                                <div
                                        class="relative inline-flex max-w-full flex-col overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                        style={visualAttachmentWrapperStyle}
                                >
                                        {#if attachment.isImage && attachment.previewUrl}
                                                <img
                                                        src={attachment.previewUrl}
                                                        alt={attachment.filename}
                                                        class="block select-none"
                                                        style={visualAttachmentMediaStyle}
                                                />
                                        {:else}
                                                <div
                                                        class="grid place-items-center bg-[var(--panel-strong)] text-[var(--muted)]"
                                                        style={`${visualAttachmentMediaStyle} ${visualAttachmentPlaceholderStyle}`}
                                                >
                                                        <Paperclip class="h-6 w-6" stroke-width={2} />
                                                </div>
                                        {/if}
                                        <div class="flex items-start gap-2 px-2 py-2">
                                                <div class="flex-1 truncate text-xs text-[var(--fg)]">
                                                        {attachment.filename}
                                                </div>
                                        </div>
                                        <button
                                                class="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-[var(--panel-strong)] text-[var(--muted)] hover:text-[var(--fg)]"
                                                type="button"
                                                onclick={() => removeAttachment(attachment.localId)}
                                                aria-label="Remove attachment"
                                        >
                                                <X class="h-3.5 w-3.5" stroke-width={2} />
                                        </button>
                                </div>
                        {/each}
                </div>
        {/if}
        <div
                class="chat-input flex items-end gap-2 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-2 py-1 focus-within:border-[var(--stroke)] focus-within:shadow-none focus-within:ring-0 focus-within:ring-offset-0 focus-within:outline-none"
        >
                <AttachmentUploader
                        bind:this={uploaderRef}
                        {attachments}
                        inline
                        on:updated={(event: CustomEvent<PendingAttachment[]>) => {
                                mergeAttachments(event.detail);
                        }}
                />
                <textarea
                        bind:this={ta}
                        class="max-h-[40vh] min-h-[2.125rem] flex-1 resize-none appearance-none border-0 bg-transparent px-1 py-1 shadow-none ring-0 outline-none focus:border-0 focus:border-transparent focus:shadow-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus:outline-none"
                        rows={1}
                        placeholder={m.message_placeholder({ channel: channelName() })}
                        bind:value={content}
                        oninput={handleInput}
                        onkeydown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send();
                                }
                        }}
                ></textarea>
                <button
                        class="grid h-8 w-8 place-items-center rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50"
                        disabled={sending || (!content.trim() && attachments.length === 0)}
                        onclick={send}
                        aria-label={m.send()}
                >
                        <Send class="h-[18px] w-[18px]" stroke-width={2} />
                </button>
        </div>
</div>
