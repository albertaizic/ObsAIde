import { ASSISTANT_NAME } from '../constants';
import type { Conversation } from './conversation';

export type ConversationExportMode = 'questions-answers' | 'answers-only';

/** Characters Obsidian rejects in a filename. */
export function sanitizeExportName(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '-');
}

/**
 * Render a conversation into the Markdown body of an exported note.
 *
 * Pure and provider-agnostic: it never touches the vault, so the mode
 * decision it implements can be tested without a real Obsidian environment.
 */
export function buildConversationExportContent(
	conversation: Conversation,
	title: string,
	mode: ConversationExportMode,
	createdOn: Date = new Date(),
): string {
	const lines: string[] = [
		'---',
		`created: ${createdOn.toISOString().split('T')[0]}`,
		'source: ObsAIde',
		'---',
		'',
		`# ${title}`,
		'',
	];

	if (mode === 'questions-answers') {
		for (const message of conversation.messages) {
			if (message.role === 'user') {
				const prefix = message.actionLabel ? `${message.actionLabel}: ` : '';
				lines.push('## You', '', `${prefix}${message.text}`, '');
			} else if (message.role === 'assistant' && message.text.trim() && !message.error) {
				lines.push(`## ${ASSISTANT_NAME}`, '', message.text, '');
			}
		}
	} else {
		for (const message of conversation.messages) {
			if (message.role === 'assistant' && message.text.trim() && !message.error) {
				lines.push(message.text, '', '---', '');
			}
		}
	}

	return lines.join('\n');
}
