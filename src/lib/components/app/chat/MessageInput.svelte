<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedChannelId, selectedGuildId, channelsByGuild } from '$lib/stores/appState';
        import AttachmentUploader from './AttachmentUploader.svelte';
        import { createEventDispatcher, onMount, tick } from 'svelte';
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

        let content = '';
        let attachments: PendingAttachment[] = [];
        let sending = false;
        const dispatch = createEventDispatcher<{ sent: void }>();

	let ta: HTMLTextAreaElement | null = null;

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

	onMount(() => {
		autoResize();
	});

        function removeAttachment(localId: string) {
                const index = attachments.findIndex((attachment) => attachment.localId === localId);
                if (index === -1) return;
                const [removed] = attachments.splice(index, 1);
                attachments = [...attachments];
                if (removed?.previewUrl && removed.previewUrl.startsWith('blob:')) {
                        try {
                                URL.revokeObjectURL(removed.previewUrl);
                        } catch {
                                /* ignore */
                        }
                }
        }

        function createLocalMessageId(): string {
                if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                        return crypto.randomUUID();
                }
                return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }

        function cloneAttachmentForSend(attachment: PendingAttachment): PendingAttachment {
                return {
                        ...attachment,
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
                attachments = [];
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

        async function uploadWithProgress(
                url: string,
                file: File,
                onProgress: (uploaded: number, total: number) => void
        ) {
                const contentType = file.type || 'application/octet-stream';
                if (typeof XMLHttpRequest === 'undefined') {
                        const res = await fetch(url, {
                                method: 'PUT',
                                body: file,
                                headers: { 'Content-Type': contentType }
                        });
                        if (!res.ok) {
                                throw new Error(`Upload failed with status ${res.status}`);
                        }
                        onProgress(file.size, file.size);
                        return;
                }

                await new Promise<void>((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('PUT', url);
                        try {
                                xhr.setRequestHeader('Content-Type', contentType);
                        } catch {
                                // ignore header set failures
                        }
                        xhr.upload.onprogress = (event) => {
                                if (event.lengthComputable) {
                                        onProgress(event.loaded, event.total);
                                }
                        };
                        xhr.onerror = () => {
                                reject(new Error('Upload failed'));
                        };
                        xhr.onload = () => {
                                if (xhr.status >= 200 && xhr.status < 300) {
                                        onProgress(file.size, file.size);
                                        resolve();
                                } else {
                                        reject(new Error(`Upload failed with status ${xhr.status}`));
                                }
                        };
                        xhr.send(file);
                });
        }

        async function processPendingMessage(message: PendingMessage) {
                const { localId, attachments: pendingAttachments, content: messageContent, channelId } = message;
                const successfulIds: bigint[] = [];

                for (const attachment of pendingAttachments) {
                        if (!attachment.uploadUrl || attachment.attachmentId == null) {
                                updatePendingAttachment(localId, attachment.localId, () => ({
                                        ...attachment,
                                        status: 'error',
                                        progress: 0,
                                        uploadedBytes: 0,
                                        error: 'Missing upload URL'
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
                                await uploadWithProgress(attachment.uploadUrl, attachment.file, (uploaded, total) => {
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
                                });
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

<div class="border-t border-[var(--stroke)] p-3">
        {#if attachments.length}
                <div class="mb-3 flex flex-wrap gap-3">
                        {#each attachments as attachment (attachment.localId)}
                                <div class="relative w-40 overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]">
                                        {#if attachment.isImage && attachment.previewUrl}
                                                <img
                                                        src={attachment.previewUrl}
                                                        alt={attachment.filename}
                                                        class="h-32 w-full object-cover"
                                                />
                                        {:else}
                                                <div class="grid h-32 place-items-center bg-[var(--panel-strong)] text-[var(--muted)]">
                                                        <Paperclip class="h-6 w-6" stroke-width={2} />
                                                </div>
                                        {/if}
                                        <div class="flex items-start gap-2 px-2 py-2">
                                                <div class="flex-1 truncate text-xs text-[var(--fg)]" title={attachment.filename}>
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
                        {attachments}
                        inline
                        on:updated={() => {
                                attachments = [...attachments];
                        }}
                />
                <textarea
                        bind:this={ta}
                        class="max-h-[40vh] min-h-[2.125rem] flex-1 resize-none appearance-none border-0 bg-transparent px-1 py-1 shadow-none ring-0 outline-none focus:border-0 focus:border-transparent focus:shadow-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus:outline-none"
                        rows={1}
                        placeholder={m.message_placeholder({ channel: channelName() })}
                        bind:value={content}
                        oninput={autoResize}
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
