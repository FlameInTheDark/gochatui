<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedChannelId } from '$lib/stores/appState';
        import { createEventDispatcher } from 'svelte';
        import { LoaderCircle, Paperclip } from 'lucide-svelte';
        import { tooltip } from '$lib/actions/tooltip';

	let { attachments, inline = false } = $props<{
		attachments: (number | string)[];
		inline?: boolean;
	}>();
	let loading = $state(false);
	let error: string | null = $state(null);
	const dispatch = createEventDispatcher<{ updated: void }>();

	async function pickFiles(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files || !$selectedChannelId) return;
		loading = true;
		error = null;
		try {
			for (const file of Array.from(files)) {
				const meta = await getFileMeta(file);
				const res = await auth.api.message.messageChannelChannelIdAttachmentPost({
					channelId: Number($selectedChannelId),
					messageUploadAttachmentRequest: {
						filename: file.name,
						file_size: file.size,
						width: meta.width ?? undefined,
						height: meta.height ?? undefined
					}
				});
				const data = res.data as {
					id?: string | number;
					attachment_id?: string | number;
				};
				const id = data.id ?? data.attachment_id;
				if (id) {
					attachments.push(id);
					// notify parent for re-render/bindings
					dispatch('updated');
				}
			}
		} catch (e) {
			const err = e as {
				response?: { data?: { message?: string } };
				message?: string;
			};
			error = err.response?.data?.message ?? err.message ?? 'Attachment failed';
		} finally {
			loading = false;
			// reset input value
			(e.target as HTMLInputElement).value = '';
		}
	}

	function getFileMeta(file: File): Promise<{ width?: number; height?: number }> {
		return new Promise((resolve) => {
			if (!file.type.startsWith('image/')) return resolve({});
			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(url);
				resolve({ width: img.width, height: img.height });
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve({});
			};
			img.src = url;
		});
	}
</script>

<div
	class="flex items-center gap-2"
	role="button"
	tabindex="0"
	on:dragover={(e: DragEvent) => e.preventDefault()}
	on:drop={(e: DragEvent) => {
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
		<input type="file" class="hidden" multiple on:change={pickFiles} />
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
