import { describe, expect, it } from 'vitest';
import type { DtoMessage } from '$lib/api';
import { applyMessageEventToList } from './messageEventHandlers';

describe('applyMessageEventToList', () => {
	const baseMessage = (overrides: Partial<DtoMessage> = {}): DtoMessage => ({
		id: '1',
		channel_id: '10',
		guild_id: '100',
		content: 'hello',
		type: 0,
		author: null,
		attachments: [],
		mentions: [],
		mention_roles: [],
		mention_everyone: false,
		pinned: false,
		timestamp: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		flags: 0,
		components: [],
		embeds: [],
		reactions: [],
		...overrides
	});

	it('appends new messages when channel matches and user is not at bottom', () => {
		const event = {
			op: 0,
			t: 101,
			d: {
				message: {
					...baseMessage({ id: '2', content: 'second' }),
					author_id: '42'
				}
			}
		};

		const result = applyMessageEventToList({
			event,
			currentMessages: [baseMessage()],
			selectedChannelId: '10',
			wasAtBottom: false
		});

		expect(result).not.toBeNull();
		expect(result?.messages).toHaveLength(2);
		expect(result?.messages[1].content).toBe('second');
		expect(result?.messages[1].author).toBe('42');
		expect(result?.shouldScrollToBottom).toBe(false);
		expect(result?.newCountDelta).toBe(1);
	});

	it('merges updates for existing messages', () => {
		const existing = baseMessage({ content: 'old content' });
		const event = {
			op: 0,
			t: 101,
			d: {
				message: baseMessage({ content: 'updated content' })
			}
		};

		const result = applyMessageEventToList({
			event,
			currentMessages: [existing],
			selectedChannelId: '10',
			wasAtBottom: false
		});

		expect(result).not.toBeNull();
		expect(result?.messages).toHaveLength(1);
		expect(result?.messages[0].content).toBe('updated content');
		expect(result?.newCountDelta).toBe(0);
		expect(result?.shouldScrollToBottom).toBe(false);
	});

	it('removes messages for delete events', () => {
		const event = {
			op: 0,
			t: 102,
			d: {
				channel_id: '10',
				message_id: '1'
			}
		};

		const result = applyMessageEventToList({
			event,
			currentMessages: [baseMessage()],
			selectedChannelId: '10',
			wasAtBottom: false
		});

		expect(result).not.toBeNull();
		expect(result?.messages).toHaveLength(0);
		expect(result?.newCountDelta).toBe(0);
	});

	it('ignores unread indicator frames with message_id when t=300', () => {
		const event = {
			op: 0,
			t: 300,
			d: {
				channel_id: '10',
				message_id: '1'
			}
		};

		const result = applyMessageEventToList({
			event,
			currentMessages: [baseMessage()],
			selectedChannelId: '10',
			wasAtBottom: false
		});

		expect(result).toBeNull();
	});

	it('ignores ack confirmation frames with message_id when t=320', () => {
		const event = {
			op: 0,
			t: 320,
			d: {
				channel_id: '10',
				message_id: '1'
			}
		};

		const result = applyMessageEventToList({
			event,
			currentMessages: [baseMessage()],
			selectedChannelId: '10',
			wasAtBottom: false
		});

		expect(result).toBeNull();
	});

	it('scrolls to bottom when sticking to the latest message', () => {
		const event = {
			op: 0,
			t: 101,
			d: {
				message: baseMessage({ id: '3' })
			}
		};

		const result = applyMessageEventToList({
			event,
			currentMessages: [baseMessage()],
			selectedChannelId: '10',
			wasAtBottom: true
		});

		expect(result).not.toBeNull();
		expect(result?.shouldScrollToBottom).toBe(true);
		expect(result?.newCountDelta).toBe(0);
	});
});
