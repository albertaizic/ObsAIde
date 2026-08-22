import { describe, expect, it } from 'vitest';
import {
	conversationTitle,
	createBranch,
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

describe('createBranch', () => {
	it('copies history up to and including the target message only', () => {
		const parent = createConversation('chat');
		parent.messages.push(createMessage('user', 'first'));
		const target = createMessage('assistant', 'second');
		parent.messages.push(target);
		parent.messages.push(createMessage('user', 'third'));

		const branch = createBranch(parent, target.id);
		expect(branch.messages.map((message) => message.text)).toEqual(['first', 'second']);
		expect(branch.messages).toHaveLength(2);
	});

	it('copies messages so mutating a branch message leaves the parent alone', () => {
		const parent = createConversation('chat');
		parent.title = 'Topic';
		const target = createMessage('user', 'first');
		parent.messages.push(target);

		const branch = createBranch(parent, target.id);
		expect(branch.messages[0]).not.toBe(parent.messages[0]);
		expect(branch.messages[0].text).toBe('first');

		branch.messages[0].text = 'mutated';
		expect(parent.messages[0].text).toBe('first');

		branch.messages.pop();
		expect(parent.messages).toHaveLength(1);
	});

	it('sets branch metadata pointing back at the parent', () => {
		const parent = createConversation('chat');
		parent.title = 'My Topic';
		const target = createMessage('user', 'hello');
		parent.messages.push(target);

		const branch = createBranch(parent, target.id);
		expect(branch.parentConversationId).toBe(parent.id);
		expect(branch.branchedFromMessageId).toBe(target.id);
		expect(branch.branchName).toBe('My Topic · Branch');
		expect(branch.title).toBe('My Topic · Branch');
		expect(branch.id).not.toBe(parent.id);
	});

	it('keeps a single branch suffix when branching a branch', () => {
		const root = createConversation('chat');
		root.title = 'My Topic';
		const first = createMessage('user', 'a');
		root.messages.push(first);

		const firstBranch = createBranch(root, first.id);
		const second = createMessage('assistant', 'b');
		firstBranch.messages.push(second);

		const secondBranch = createBranch(firstBranch, second.id);
		expect(secondBranch.branchName).toBe('My Topic · Branch');
		expect(getRootConversationTitle(secondBranch)).toBe('My Topic');
	});

	it('throws when the message id is missing from the parent', () => {
		const parent = createConversation('chat');
		parent.messages.push(createMessage('user', 'first'));
		expect(() => createBranch(parent, 'm-nope')).toThrow();
	});

	it('inherits mode, profile and context scope from the parent', () => {
		const parent = createConversation('tutor');
		parent.activeProfileId = 'general';
		parent.contextScope = 'selection';
		const target = createMessage('user', 'hi');
		parent.messages.push(target);

		const branch = createBranch(parent, target.id);
		expect(branch.mode).toBe('tutor');
		expect(branch.activeProfileId).toBe('general');
		expect(branch.contextScope).toBe('selection');
	});
});
