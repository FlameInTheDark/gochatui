<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import type { PendingAttachment, PendingMessage } from '$lib/stores/pendingMessages';
        import { resolveAvatarUrl } from '$lib/utils/avatar';
        import { Paperclip, AlertCircle } from 'lucide-svelte';

        const me = auth.user;
        const { message } = $props<{ message: PendingMessage }>();

        function userDisplayName() {
                const name = ($me as any)?.global_name ?? ($me as any)?.username ?? 'You';
                return name;
        }

        const avatarUrl = $derived.by(() => resolveAvatarUrl($me));

        function statusLabel(status: typeof message.status) {
                if (status === 'error') return 'Failed to send';
                return 'Sending…';
        }

        function relativeTime(date: Date): string {
                const diff = Date.now() - date.getTime();
                if (!Number.isFinite(diff) || diff < 0) return 'Just now';
                const minutes = Math.floor(diff / 60000);
                if (minutes <= 0) return 'Just now';
                if (minutes === 1) return '1 minute ago';
                if (minutes < 60) return `${minutes} minutes ago`;
                const hours = Math.floor(minutes / 60);
                if (hours === 1) return '1 hour ago';
                if (hours < 24) return `${hours} hours ago`;
                const days = Math.floor(hours / 24);
                if (days === 1) return '1 day ago';
                return `${days} days ago`;
        }

        function attachmentStatusLabel(
                attachment: PendingAttachment,
                messageStatus: typeof message.status
        ) {
                switch (attachment.status) {
                        case 'queued':
                                return 'Queued';
                        case 'uploading':
                                return 'Uploading…';
                        case 'success':
                                return messageStatus === 'pending' ? 'Processing…' : 'Uploaded';
                        case 'error':
                                return 'Failed';
                        default:
                                return '';
                }
        }

        const VISUAL_ATTACHMENT_MAX_DIMENSION = 350;
        const visualAttachmentWrapperStyle = `max-width: min(100%, ${VISUAL_ATTACHMENT_MAX_DIMENSION}px);`;
        const visualAttachmentMediaStyle = `max-width: 100%; max-height: ${VISUAL_ATTACHMENT_MAX_DIMENSION}px; width: auto; height: auto;`;
        const visualAttachmentPlaceholderStyle = `min-height: min(${VISUAL_ATTACHMENT_MAX_DIMENSION}px, 8rem);`;
</script>

<div class="flex gap-3 px-3 py-2 opacity-90" data-pending-message>
        <div class="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--panel)]">
                {#if avatarUrl}
                        <img src={avatarUrl} alt={userDisplayName()} class="h-full w-full object-cover" />
                {:else}
                        <div class="grid h-full w-full place-items-center text-sm font-semibold uppercase text-[var(--brand)]">
                                {userDisplayName().slice(0, 2)}
                        </div>
                {/if}
        </div>
        <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                        <span class="font-semibold text-[var(--fg)]">{userDisplayName()}</span>
                        <span>{statusLabel(message.status)}</span>
                        <span>•</span>
                        <span>{relativeTime(message.createdAt)}</span>
                </div>
                {#if message.content}
                        <div class="mt-1 whitespace-pre-wrap text-sm text-[var(--fg)]">{message.content}</div>
                {/if}
                {#if message.attachments.length}
                        <div class="mt-2 flex flex-wrap gap-3">
                                {#each message.attachments as attachment (attachment.localId)}
                                        <div
                                                class="relative inline-flex max-w-full flex-col overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)] text-xs"
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
                                                <div class="space-y-1 px-2 py-2">
                                                        <div class="truncate font-medium text-[var(--fg)]">
                                                                {attachment.filename}
                                                        </div>
                                                        <div class="flex items-center justify-between text-[var(--muted)]">
                                                                <span>{attachmentStatusLabel(attachment, message.status)}</span>
                                                                <span>{Math.round(attachment.progress * 100)}%</span>
                                                        </div>
                                                </div>
                                                <div class="absolute inset-x-0 bottom-0 h-1 bg-[var(--panel-strong)]">
                                                        <div
                                                                class="h-full bg-[var(--brand)] transition-all"
                                                                style={`width: ${Math.min(100, Math.max(0, Math.round(attachment.progress * 100)))}%`}
                                                        ></div>
                                                </div>
                                                {#if attachment.status === 'error' && attachment.error}
                                                        <div class="absolute inset-x-0 bottom-1 flex items-center gap-1 px-2 text-[10px] text-red-400">
                                                                <AlertCircle class="h-3 w-3" stroke-width={2} />
                                                                <span class="truncate">{attachment.error}</span>
                                                        </div>
                                                {/if}
                                        </div>
                                {/each}
                        </div>
                {/if}
                {#if message.status === 'error' && message.error}
                        <div class="mt-2 flex items-center gap-1 text-xs text-red-400">
                                <AlertCircle class="h-3.5 w-3.5" stroke-width={2} />
                                <span>{message.error}</span>
                        </div>
                {/if}
        </div>
</div>
