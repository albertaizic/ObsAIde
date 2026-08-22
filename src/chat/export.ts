import { ASSISTANT_NAME } from '../constants';
import type { Conversation } from './conversation';

export type ConversationExportMode = 'questions-answers' | 'answers-only';

/** Characters Obsidian rejects in a filename. */
export function sanitizeExportName(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '-');
}

/** Result of checking export inputs: either a ready-to-run export or why not. */
export type ExportValidation =
	| { valid: true; name: string; folder: string; mode: ConversationExportMode }
	| { valid: false; reason: 'missing-name' | 'missing-mode' };

/**
 * Validate export inputs before anything is written.
 * The name and folder are trimmed; a missing name or unselected mode blocks.
 */
export function validateExportInput(
	rawName: string,
	rawFolder: string,
	mode: ConversationExportMode | null,
): ExportValidation {
	const trimmedName = rawName.trim();
	if (!trimmedName) return { valid: false, reason: 'missing-name' };
	if (!mode) return { valid: false, reason: 'missing-mode' };
	return { valid: true, name: trimmedName, folder: rawFolder.trim(), mode };
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
