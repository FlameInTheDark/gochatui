<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { selectedChannelId } from '$lib/stores/appState';
	import { tooltip } from '$lib/actions/tooltip';
	import { createEventDispatcher } from 'svelte';
	import { LoaderCircle, Paperclip } from 'lucide-svelte';
	import type { PendingAttachment } from '$lib/stores/pendingMessages';
	import {
		createObjectUrl,
		parseAttachmentUploadSlot,
		readMediaDimensions
	} from '$lib/utils/attachmentUpload';

	let { attachments, inline = false } = $props<{
		attachments: PendingAttachment[];
		inline?: boolean;
	}>();

	let loading = $state(false);
	let error: string | null = $state(null);
	const dispatch = createEventDispatcher<{ updated: PendingAttachment[] }>();

	function toFileArray(input: FileList | File[] | null | undefined): File[] {
		if (!input) return [];
		return Array.from(input as FileList | File[]);
	}

	function getErrorMessage(err: unknown): string {
		const error = err as { response?: { data?: { message?: string } }; message?: string };
		return error.response?.data?.message ?? error.message ?? 'Attachment failed';
	}

	function createLocalId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	export async function addFiles(
		filesInput: FileList | File[] | null | undefined
	): Promise<PendingAttachment[]> {
		const files = toFileArray(filesInput);
		if (!files.length) return [];

		const selected = $selectedChannelId;
		if (!selected) {
			error = 'Select a channel first';
			return [];
		}

		let channelId: bigint;
		try {
			channelId = BigInt(selected);
		} catch {
			error = 'Invalid channel selected';
			return [];
		}

		loading = true;
		error = null;

		const created: PendingAttachment[] = [];

		try {
			for (const file of files) {
				try {
					const dimensions = await readMediaDimensions(file);
					const response = await auth.api.message.messageChannelChannelIdAttachmentPost({
						channelId: channelId as unknown as number,
						messageUploadAttachmentRequest: {
							filename: file.name,
							content_type: file.type || 'application/octet-stream',
							file_size: file.size,
							width: dimensions.width,
							height: dimensions.height
						}
					});

					const slot = parseAttachmentUploadSlot(response.data);
					const previewUrl = createObjectUrl(file);

					created.push({
						localId: createLocalId(),
						attachmentId: slot.attachmentId,
						uploadUrl: slot.uploadUrl,
						uploadHeaders: slot.uploadHeaders,
						file,
						filename: file.name,
						size: file.size,
						mimeType: file.type || 'application/octet-stream',
						width: dimensions.width,
						height: dimensions.height,
						previewUrl,
						isImage: file.type.startsWith('image/'),
						status: 'queued',
						progress: 0,
						uploadedBytes: 0,
						error: null
					});
				} catch (err) {
					const message = getErrorMessage(err);
					console.error('Failed to prepare attachment', err);
					error = message;
				}
			}
		} finally {
			loading = false;
		}

		if (created.length) {
			dispatch('updated', created);
		}

		return created;
	}

	async function pickFiles(event: Event) {
		const target = event.target as HTMLInputElement | { files: FileList | null };
		try {
			await addFiles(target.files ?? null);
		} finally {
			if ('value' in target) {
				target.value = '';
			}
		}
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		const transfer = event.dataTransfer;
		if (!transfer || !transfer.files?.length) return;
		await addFiles(transfer.files);
		transfer.clearData();
	}
</script>

<div
	class="flex items-center gap-2"
	role="button"
	tabindex="0"
	ondragover={(event: DragEvent) => event.preventDefault()}
	ondrop={handleDrop}
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
