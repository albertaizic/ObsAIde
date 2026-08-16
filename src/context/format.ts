import { truncateText } from '../utils/text';
import type { ContextLimits, ResolvedAttachment } from './types';

const TRUNCATION_MARKER = '\n\n[… truncated by ObsAIde …]';

function escapeAttribute(value: string): string {
	return value.replace(/"/g, "'");
}

/**
 * Apply the per-note and whole-request character caps.
 *
 * Attachments are trimmed in order, so the material the user attached first
 * survives when the budget runs out.
 */
export function applyContextLimits(
	parts: ResolvedAttachment[],
	limits: ContextLimits,
): ResolvedAttachment[] {
	let remaining = limits.maxContextChars;
	return parts.map((part) => {
		if (part.missing) return part;
		const perNote = truncateText(part.content, limits.maxCharsPerNote);
		const budgeted = truncateText(perNote.text, Math.max(0, remaining));
		remaining = Math.max(0, remaining - budgeted.text.length);
		return {
			...part,
			content: budgeted.text,
			truncated: part.truncated || perNote.truncated || budgeted.truncated,
		};
	});
}

/** Render attachments as a tagged block the model can reference precisely. */
export function formatContextBlock(parts: ResolvedAttachment[]): string {
	if (parts.length === 0) return '';

	const blocks = parts.map((part) => {
		const { attachment } = part;
		const attributes: string[] = [`type="${attachment.kind}"`];
		if (attachment.path) attributes.push(`note="${escapeAttribute(attachment.path)}"`);
		if (attachment.lines) {
			attributes.push(`lines="${attachment.lines.from}-${attachment.lines.to}"`);
		}
		const open = `<attachment ${attributes.join(' ')}>`;

		if (part.missing) {
			return `${open}\n[This note is no longer available in the vault.]\n</attachment>`;
		}
		const body = part.truncated ? `${part.content}${TRUNCATION_MARKER}` : part.content;
		return `${open}\n${body}\n</attachment>`;
	});

	return [
		'The user attached the following material from their Obsidian vault. Treat it as the primary context for this request.',
		...blocks,
	].join('\n\n');
}

/** Combine the context block with what the user typed. */
export function composeUserContent(contextBlock: string, question: string): string {
	const prompt = question.trim();
	if (!contextBlock) return prompt;
	if (!prompt) return contextBlock;
	return `${contextBlock}\n\n${prompt}`;
}
