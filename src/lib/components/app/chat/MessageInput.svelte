<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { selectedChannelId, selectedGuildId, channelsByGuild } from '$lib/stores/appState';
	import AttachmentUploader from './AttachmentUploader.svelte';
	import { SvelteSet, createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { Send, X, Paperclip } from 'lucide-svelte';
	import type { DtoChannel } from '$lib/api';
	import {
		addPendingMessage,
		removePendingMessage,
		updatePendingAttachment,
		updatePendingMessage,
		type PendingAttachment,
		type PendingMessage
	} from '$lib/stores/pendingMessages';
	import {
		cloneAttachmentWithFreshPreview,
		revokeObjectUrl,
		uploadFileWithProgress
	} from '$lib/utils/attachmentUpload';

	let content = $state('');
	let attachments = $state<PendingAttachment[]>([]);
	let sending = $state(false);
	const dispatch = createEventDispatcher<{ sent: void }>();

	let ta: HTMLTextAreaElement | null = null;
	let uploaderRef: {
		addFiles?: (files: FileList | File[] | null | undefined) => Promise<PendingAttachment[] | void>;
	} | null = null;
	let dropActive = false;
	let dragCounter = 0;
	let removeGlobalDragListeners: (() => void) | null = null;

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
		const existing = new SvelteSet(attachments.map((attachment) => attachment.localId));
		const next: PendingAttachment[] = attachments.slice();
		for (const attachment of added) {
			if (existing.has(attachment.localId)) {
				continue;
			}
			existing.add(attachment.localId);
			next.push(attachment);
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

	const VISUAL_ATTACHMENT_MAX_DIMENSION = 350;
	const visualAttachmentWrapperStyle = `max-width: min(100%, ${VISUAL_ATTACHMENT_MAX_DIMENSION}px);`;
	const visualAttachmentMediaStyle = `max-width: 100%; max-height: ${VISUAL_ATTACHMENT_MAX_DIMENSION}px; width: auto; height: auto;`;
	const visualAttachmentPlaceholderStyle = `min-height: min(${VISUAL_ATTACHMENT_MAX_DIMENSION}px, 8rem);`;

	// Derive current channel name to show in placeholder
	function currentChannel(): DtoChannel | undefined {
		const gid = $selectedGuildId ?? '';
		const channels = $channelsByGuild[gid] ?? [];
		const selected = $selectedChannelId;
		if (!selected) return undefined;
		return channels.find((channel) => {
			const id = channel?.id;
			if (id == null) return false;
			try {
				return String(id) === selected;
			} catch {
				return false;
			}
		});
	}
	function channelName(): string {
		const channel = currentChannel();
		if (!channel) return '';
		const { name } = channel;
		return name != null ? String(name) : '';
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
	});

	function releasePreviewUrl(attachment: PendingAttachment | undefined) {
		if (!attachment) return;
		revokeObjectUrl(attachment.previewUrl);
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

	async function send() {
		const channelId = $selectedChannelId;
		const trimmedContent = content.trim();
		if (!channelId || (!trimmedContent && attachments.length === 0)) return;
		sending = true;

		const localMessageId = createLocalMessageId();
		const attachmentsForSend = attachments.map(cloneAttachmentWithFreshPreview);
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

	async function processPendingMessage(message: PendingMessage) {
		const {
			localId,
			attachments: pendingAttachments,
			content: messageContent,
			channelId
		} = message;
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
				await uploadFileWithProgress({
					url: attachment.uploadUrl,
					file: attachment.file,
					headers: attachment.uploadHeaders,
					onProgress: ({ uploadedBytes, totalBytes }) => {
						updatePendingAttachment(localId, attachment.localId, (current) => {
							const fallbackTotal = current.size > 0 ? current.size : totalBytes;
							const denominator = totalBytes > 0 ? totalBytes : fallbackTotal;
							const ratio = denominator > 0 ? Math.min(1, uploadedBytes / denominator) : 1;
							return {
								...current,
								uploadedBytes:
									denominator > 0 ? Math.min(uploadedBytes, denominator) : uploadedBytes,
								progress: ratio
							};
						});
					}
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
				channelId: channelId as unknown as number,
				messageSendMessageRequest: {
					content: messageContent,
					attachments: successfulIds as unknown as number[]
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
						<div class="flex-1 truncate text-xs text-[var(--fg)]" title={attachment.filename}>
							{attachment.filename}
						</div>
					</div>
					<button
						class="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-[var(--panel-strong)] text-[var(--muted)] hover:text-[var(--fg)]"
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
