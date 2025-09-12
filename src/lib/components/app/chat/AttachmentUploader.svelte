<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { selectedChannelId } from '$lib/stores/appState';
	import { createEventDispatcher } from 'svelte';

	let { attachments, inline = false } = $props<{
		attachments: (number | string)[];
		inline?: boolean;
	}>();
	let loading = false;
	let error: string | null = null;
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
			? 'grid h-9 w-9 cursor-pointer place-items-center rounded-md hover:bg-[var(--panel)]'
			: 'cursor-pointer rounded-md border border-[var(--stroke)] px-2 py-1'}
		title={loading ? 'Uploading…' : 'Attach files'}
	>
		<input type="file" class="hidden" multiple onchange={pickFiles} />
		{#if inline}
			{#if loading}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="currentColor"
					class="animate-spin"><path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2z" /></svg
				>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="currentColor"
					><path
						d="M16.5,6.5 L8.5,14.5 C7.67157288,15.3284271 7.67157288,16.6715729 8.5,17.5 C9.32842712,18.3284271 10.6715729,18.3284271 11.5,17.5 L19.5,9.5 C21.1568542,7.84314575 21.1568542,5.15685425 19.5,3.5 C17.8431458,1.84314575 15.1568542,1.84314575 13.5,3.5 L5.5,11.5 C3.01471863,13.9852814 3.01471863,18.0147186 5.5,20.5 C7.98528137,22.9852814 12.0147186,22.9852814 14.5,20.5 L20,15"
						stroke="currentColor"
						stroke-width="2"
						fill="none"
					/></svg
				>
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
