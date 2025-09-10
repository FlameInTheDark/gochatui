<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId } from '$lib/stores/appState';

  let { attachments } = $props<{ attachments: (number | string)[] }>();
  let loading = false;
  let error: string | null = null;

  async function pickFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || !$selectedChannelId) return;
    loading = true; error = null;
    try {
      for (const file of Array.from(files)) {
        const meta = await getFileMeta(file);
        const res = await auth.api.message.messageChannelChannelIdAttachmentPost({
          channelId: $selectedChannelId,
          messageUploadAttachmentRequest: {
            filename: file.name,
            file_size: file.size,
            width: meta.width ?? undefined,
            height: meta.height ?? undefined
          }
        });
        const id = ((res.data as any)?.id ?? (res.data as any)?.attachment_id) as string | number | undefined;
        if (id) attachments.push(id);
      }
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Attachment failed';
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
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => resolve({});
      img.src = URL.createObjectURL(file);
    });
  }
</script>

<div class="flex items-center gap-2" on:dragover|preventDefault on:drop|preventDefault={(e) => { const dt = (e as DragEvent).dataTransfer; if (!dt) return; const files = dt.files; if (files && files.length) { const inputLike = { files } as any; pickFiles({ target: inputLike } as any as Event); } }}>
  <label class="px-2 py-1 rounded-md border border-[var(--stroke)] cursor-pointer">
    <input type="file" class="hidden" multiple on:change={pickFiles} />
    {loading ? 'Uploading…' : 'Attach'}
  </label>
  {#if error}<span class="text-xs text-red-400">{error}</span>{/if}
  {#if attachments.length}
    <span class="text-xs text-[var(--muted)]">{attachments.length} attachment(s)</span>
  {/if}
</div>
