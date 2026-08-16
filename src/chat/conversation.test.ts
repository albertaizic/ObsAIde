import { describe, expect, it } from 'vitest';
import {
	conversationTitle,
	createConversation,
	createMessage,
	isEmptyConversation,
	toProviderMessages,
} from './conversation';

describe('conversations', () => {
	it('starts empty', () => {
		const conversation = createConversation('chat');
		expect(isEmptyConversation(conversation)).toBe(true);
		expect(conversationTitle(conversation)).toBe('New conversation');
	});

	it('titles itself from the first user turn', () => {
		const conversation = createConversation('chat');
		conversation.messages.push(createMessage('user', 'How does spaced repetition work?'));
		expect(conversationTitle(conversation)).toBe('How does spaced repetition work?');
	});

	it('prefixes the title with the action that started it', () => {
		const conversation = createConversation('chat');
		conversation.messages.push(
			createMessage('user', 'Improve writing', { actionLabel: 'Improve writing' }),
		);
		expect(conversationTitle(conversation)).toBe('Improve writing: Improve writing');
	});
});

describe('toProviderMessages', () => {
	it('sends the context-bearing text rather than the displayed text', () => {
		const conversation = createConversation('chat');
		conversation.messages.push(
			createMessage('user', 'Why?', { sentText: '<attachment>…</attachment>\n\nWhy?' }),
		);
		expect(toProviderMessages(conversation)).toEqual([
			{ role: 'user', content: '<attachment>…</attachment>\n\nWhy?' },
		]);
	});

	it('drops failed and empty assistant turns so a retry is clean', () => {
		const conversation = createConversation('chat');
		conversation.messages.push(createMessage('user', 'first'));
		conversation.messages.push(
			createMessage('assistant', 'partial', {
				error: { kind: 'network', message: 'offline', retryable: true },
			}),
		);
		conversation.messages.push(createMessage('assistant', '   '));
		conversation.messages.push(createMessage('user', 'second'));

		expect(toProviderMessages(conversation)).toEqual([
			{ role: 'user', content: 'first' },
			{ role: 'user', content: 'second' },
		]);
	});
});
