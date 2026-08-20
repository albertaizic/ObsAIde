import { describe, expect, it } from 'vitest';
import {
	conversationTitle,
	createConversation,
	createMessage,
	getRootConversationTitle,
	isEmptyConversation,
	migrateBranchTitles,
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

describe('branch title handling', () => {
	it('getRootConversationTitle strips old branch suffix', () => {
		const conversation = createConversation('chat');
		conversation.title = 'My Topic — Branch';
		expect(getRootConversationTitle(conversation)).toBe('My Topic');
	});

	it('getRootConversationTitle strips new branch suffix', () => {
		const conversation = createConversation('chat');
		conversation.title = 'My Topic · Branch';
		expect(getRootConversationTitle(conversation)).toBe('My Topic');
	});

	it('getRootConversationTitle handles compounded branch suffixes', () => {
		const conversation = createConversation('chat');
		conversation.title = 'My Topic — Branch — Branch — Branch';
		expect(getRootConversationTitle(conversation)).toBe('My Topic');
	});

	it('getRootConversationTitle leaves clean titles unchanged', () => {
		const conversation = createConversation('chat');
		conversation.title = 'Clean Title';
		expect(getRootConversationTitle(conversation)).toBe('Clean Title');
	});

	it('migrateBranchTitles cleans compounded titles', () => {
		const conversations = [
			createConversation('chat'),
			createConversation('chat'),
		];
		conversations[0].title = 'Topic — Branch — Branch';
		conversations[1].title = 'Clean Topic';

		const migrated = migrateBranchTitles(conversations);
		expect(migrated).toBe(1);
		expect(conversations[0].title).toBe('Topic');
		expect(conversations[1].title).toBe('Clean Topic');
	});

	it('migrateBranchTitles handles mixed old and new formats', () => {
		const conversations = [
			createConversation('chat'),
			createConversation('chat'),
		];
		conversations[0].title = 'Old — Branch';
		conversations[1].title = 'New · Branch';

		migrateBranchTitles(conversations);
		expect(conversations[0].title).toBe('Old');
		expect(conversations[1].title).toBe('New');
	});
});
