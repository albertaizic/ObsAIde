import { describe, expect, it } from 'vitest';
import { buildConversationExportContent, sanitizeExportName } from './export';
import { createConversation, createMessage, type Conversation } from './conversation';

function makeConversation(): Conversation {
	return createConversation('chat');
}

const CREATED_ON = new Date('2026-08-18T00:00:00Z');

describe('buildConversationExportContent', () => {
	it('exports questions and answers together, with the action label prefixed', () => {
		const conv = makeConversation();
		conv.messages.push(
			createMessage('user', 'Improve this text', { actionLabel: 'Improve writing' }),
			createMessage('assistant', 'Improved version...'),
		);

		const content = buildConversationExportContent(conv, 'Test', 'questions-answers', CREATED_ON);
		expect(content).toContain('## You');
		expect(content).toContain('Improve writing: Improve this text');
		expect(content).toContain('Improved version...');
	});

	it('answers-only mode omits every user turn', () => {
		const conv = makeConversation();
		conv.messages.push(
			createMessage('user', 'Q1'),
			createMessage('assistant', 'A1'),
			createMessage('user', 'Q2'),
			createMessage('assistant', 'A2'),
		);

		const content = buildConversationExportContent(conv, 'Test', 'answers-only', CREATED_ON);
		expect(content).toContain('A1');
		expect(content).toContain('A2');
		expect(content).not.toContain('Q1');
		expect(content).not.toContain('Q2');
		expect(content).not.toContain('## You');
	});

	it('skips empty and failed assistant turns in both modes', () => {
		const conv = makeConversation();
		conv.messages.push(
			createMessage('user', 'Question'),
			createMessage('assistant', '   '),
			createMessage('assistant', 'Partial', {
				error: { kind: 'network', message: 'offline', retryable: true },
			}),
			createMessage('assistant', 'Real answer'),
		);

		const full = buildConversationExportContent(conv, 'Test', 'questions-answers', CREATED_ON);
		const answersOnly = buildConversationExportContent(conv, 'Test', 'answers-only', CREATED_ON);
		expect(full).not.toContain('Partial');
		expect(answersOnly).not.toContain('Partial');
		expect(full).toContain('Real answer');
		expect(answersOnly).toContain('Real answer');
	});

	it('includes frontmatter with the export date and source', () => {
		const conv = makeConversation();
		const content = buildConversationExportContent(conv, 'Test', 'questions-answers', CREATED_ON);
		expect(content).toContain('created: 2026-08-18');
		expect(content).toContain('source: ObsAIde');
	});

	it('never includes internal message ids', () => {
		const conv = makeConversation();
		conv.messages.push(
			createMessage('user', 'Question', { id: 'msg-123' }),
			createMessage('assistant', 'Answer', { id: 'msg-456' }),
		);
		const content = buildConversationExportContent(conv, 'Test', 'questions-answers', CREATED_ON);
		expect(content).not.toContain('msg-123');
		expect(content).not.toContain('msg-456');
	});
});

describe('sanitizeExportName', () => {
	it('replaces filesystem-unsafe characters', () => {
		expect(sanitizeExportName('My "Conversation"')).toBe('My -Conversation-');
		expect(sanitizeExportName('Test/Export')).toBe('Test-Export');
	});

	it('leaves an empty name empty', () => {
		expect(sanitizeExportName('')).toBe('');
	});
});
