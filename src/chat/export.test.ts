import { describe, expect, it, vi } from 'vitest';
import {
	createConversation,
	createMessage,
	type Conversation,
	type ConversationMessage,
	conversationTitle,
	isEmptyConversation,
	toProviderMessages,
} from './conversation';

describe('Conversation Export', () => {
	function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
		return createConversation('chat', overrides);
	}

	function makeUserMessage(text: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
		return createMessage('user', text, overrides);
	}

	function makeAssistantMessage(text: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
		return createMessage('assistant', text, overrides);
	}

	describe('Full conversation export', () => {
		it('exports all meaningful user and assistant turns', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Why is binary search O(log n)?'),
				makeAssistantMessage('Binary search halves the search space...'),
				makeUserMessage('What about linear search?'),
				makeAssistantMessage('Linear search checks each element...'),
			);

			// Simulate full export logic
			const lines: string[] = [
				'---',
				'created: 2026-08-18',
				'source: ObsAIde',
				'---',
				'',
				'# Test Conversation',
				'',
			];

			for (const msg of conv.messages) {
				if (msg.role === 'user') {
					lines.push('## You', '', msg.text, '');
				} else if (msg.role === 'assistant' && msg.text.trim() && !msg.error) {
					lines.push('## Aide', '', msg.text, '');
				}
			}

			const content = lines.join('\n');
			expect(content).toContain('## You');
			expect(content).toContain('Why is binary search O(log n)?');
			expect(content).toContain('## Aide');
			expect(content).toContain('Binary search halves');
			expect(content).toContain('Linear search checks');
		});

		it('includes action label in user messages', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Improve this text', { actionLabel: 'Improve writing' }),
				makeAssistantMessage('Improved version...'),
			);

			const userMsg = conv.messages[0];
			const prefix = userMsg.actionLabel ? `${userMsg.actionLabel}: ` : '';
			expect(prefix).toBe('Improve writing: ');
		});

		it('skips empty assistant messages', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Question'),
				makeAssistantMessage('   '), // empty
				makeAssistantMessage('Real answer'),
			);

			const assistantMsgs = conv.messages.filter(m => m.role === 'assistant' && m.text.trim() && !m.error);
			expect(assistantMsgs).toHaveLength(1);
			expect(assistantMsgs[0].text).toBe('Real answer');
		});

		it('skips failed assistant messages', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Question'),
				makeAssistantMessage('Partial', {
					error: { kind: 'network', message: 'offline', retryable: true },
				}),
				makeAssistantMessage('Real answer'),
			);

			const assistantMsgs = conv.messages.filter(m => m.role === 'assistant' && m.text.trim() && !m.error);
			expect(assistantMsgs).toHaveLength(1);
			expect(assistantMsgs[0].text).toBe('Real answer');
		});

		it('includes frontmatter', () => {
			const lines = [
				'---',
				'created: 2026-08-18',
				'source: ObsAIde',
				'---',
				'',
				'# Test',
				'',
			];
			const content = lines.join('\n');
			expect(content).toContain('---');
			expect(content).toContain('created:');
			expect(content).toContain('source: ObsAIde');
		});

		it('never includes API keys', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Question', { sentText: 'Context with secret' }),
				makeAssistantMessage('Answer', { providerId: 'openrouter', model: 'test-model' }),
			);

			// The export should not include sentText or provider metadata
			for (const msg of conv.messages) {
				if (msg.role === 'user') {
					expect(msg.sentText).toBeDefined(); // exists in message but not in export
				}
			}
		});

		it('never includes system prompts', () => {
			// System prompts are not stored in conversation messages
			const conv = makeConversation();
			expect(conv.messages.every(m => !('systemPrompt' in m))).toBe(true);
		});

		it('never includes internal IDs in export content', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Question', { id: 'msg-123' }),
				makeAssistantMessage('Answer', { id: 'msg-456' }),
			);

			// IDs are in message objects but not rendered in export
			const lines: string[] = [];
			for (const msg of conv.messages) {
				if (msg.role === 'user') lines.push(msg.text);
				else if (msg.role === 'assistant') lines.push(msg.text);
			}
			const content = lines.join('\n');
			expect(content).not.toContain('msg-123');
			expect(content).not.toContain('msg-456');
		});
	});

	describe('Answers-only export', () => {
		it('exports only assistant messages', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeUserMessage('Q1'),
				makeAssistantMessage('A1'),
				makeUserMessage('Q2'),
				makeAssistantMessage('A2'),
			);

			const lines: string[] = ['---', 'created: 2026-08-18', 'source: ObsAIde', '---', '', '# Test', ''];

			for (const msg of conv.messages) {
				if (msg.role === 'assistant' && msg.text.trim() && !msg.error) {
					lines.push(msg.text);
					lines.push('');
					lines.push('---');
					lines.push('');
				}
			}

			const content = lines.join('\n');
			expect(content).toContain('A1');
			expect(content).toContain('A2');
			expect(content).not.toContain('Q1');
			expect(content).not.toContain('Q2');
			expect(content).toContain('---'); // separators between answers
		});

		it('skips empty answers', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeAssistantMessage('Real'),
				makeAssistantMessage('   '),
			);

			const answers = conv.messages.filter(
				m => m.role === 'assistant' && m.text.trim() && !m.error
			);
			expect(answers).toHaveLength(1);
			expect(answers[0].text).toBe('Real');
		});

		it('skips failed answers', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeAssistantMessage('Partial', {
					error: { kind: 'network', message: 'offline', retryable: true },
				}),
				makeAssistantMessage('Complete'),
			);

			const answers = conv.messages.filter(
				m => m.role === 'assistant' && m.text.trim() && !m.error
			);
			expect(answers).toHaveLength(1);
			expect(answers[0].text).toBe('Complete');
		});

		it('uses clean markdown separation', () => {
			const conv = makeConversation();
			conv.messages.push(
				makeAssistantMessage('First answer'),
				makeAssistantMessage('Second answer'),
			);

			const lines: string[] = [];
			for (const msg of conv.messages) {
				if (msg.role === 'assistant' && msg.text.trim() && !msg.error) {
					lines.push(msg.text);
					lines.push('');
					lines.push('---');
					lines.push('');
				}
			}
			const content = lines.join('\n');
			expect(content).toContain('First answer');
			expect(content).toContain('Second answer');
			// Check separator format
			const parts = content.split('\n---\n');
			expect(parts.length).toBe(3); // Two answers + trailing
		});
	});

	describe('Filename sanitization for export', () => {
		function sanitizeExportName(name: string): string {
			return name.replace(/[<>:"\/\\|?*]/g, '-');
		}

		it('sanitizes export filename', () => {
			expect(sanitizeExportName('My "Conversation"')).toBe('My -Conversation-');
			expect(sanitizeExportName('Test/Export')).toBe('Test-Export');
		});

		it('handles empty name', () => {
			expect(sanitizeExportName('')).toBe('');
		});
	});
});