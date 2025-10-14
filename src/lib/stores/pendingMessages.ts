import { writable } from 'svelte/store';

export type PendingAttachmentStatus = 'queued' | 'uploading' | 'success' | 'error';

export interface PendingAttachment {
        localId: string;
        attachmentId: bigint | null;
        uploadUrl: string | null;
        file: File;
        filename: string;
        size: number;
        mimeType: string;
        width?: number;
        height?: number;
        previewUrl: string | null;
        isImage: boolean;
        status: PendingAttachmentStatus;
        progress: number;
        uploadedBytes: number;
        error: string | null;
}

export type PendingMessageStatus = 'pending' | 'error';

export interface PendingMessage {
        localId: string;
        channelId: string;
        content: string;
        createdAt: Date;
        attachments: PendingAttachment[];
        status: PendingMessageStatus;
        error: string | null;
}

function cleanupAttachmentPreview(attachment: PendingAttachment) {
        try {
                if (attachment.previewUrl && attachment.previewUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(attachment.previewUrl);
                }
        } catch {
                /* no-op */
        }
}

const store = writable<PendingMessage[]>([]);

export const pendingMessages = {
        subscribe: store.subscribe
};

export function addPendingMessage(message: PendingMessage) {
        store.update((messages) => [...messages, message]);
}

export function updatePendingMessage(
        localId: string,
        mutator: (message: PendingMessage) => PendingMessage | void
) {
        store.update((messages) => {
                const index = messages.findIndex((m) => m.localId === localId);
                if (index === -1) return messages;
                const current = messages[index];
                const next = (mutator(current) ?? current) as PendingMessage;
                if (next === current) {
                        return messages;
                }
                const copy = messages.slice();
                copy[index] = next;
                return copy;
        });
}

export function updatePendingAttachment(
        messageId: string,
        attachmentId: string,
        mutator: (attachment: PendingAttachment) => PendingAttachment | void
) {
        store.update((messages) => {
                const messageIndex = messages.findIndex((m) => m.localId === messageId);
                if (messageIndex === -1) return messages;
                const message = messages[messageIndex];
                const attachmentIndex = message.attachments.findIndex((a) => a.localId === attachmentId);
                if (attachmentIndex === -1) return messages;
                const currentAttachment = message.attachments[attachmentIndex];
                const nextAttachment = (mutator(currentAttachment) ?? currentAttachment) as PendingAttachment;
                if (nextAttachment === currentAttachment) return messages;
                const nextAttachments = message.attachments.slice();
                nextAttachments[attachmentIndex] = nextAttachment;
                const nextMessage: PendingMessage = {
                        ...message,
                        attachments: nextAttachments
                };
                const nextMessages = messages.slice();
                nextMessages[messageIndex] = nextMessage;
                return nextMessages;
        });
}

export function removePendingMessage(localId: string) {
        store.update((messages) => {
                const index = messages.findIndex((m) => m.localId === localId);
                if (index === -1) return messages;
                const nextMessages = messages.slice();
                const [removed] = nextMessages.splice(index, 1);
                if (removed) {
                        for (const attachment of removed.attachments) {
                                cleanupAttachmentPreview(attachment);
                        }
                }
                return nextMessages;
        });
}

export function clearPendingMessagesForChannel(channelId: string) {
        store.update((messages) => {
                const remaining: PendingMessage[] = [];
                for (const message of messages) {
                        if (message.channelId === channelId) {
                                for (const attachment of message.attachments) {
                                        cleanupAttachmentPreview(attachment);
                                }
                                continue;
                        }
                        remaining.push(message);
                }
                return remaining;
        });
}
