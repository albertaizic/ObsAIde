import { truncateText } from '../utils/text';
import type { ContextLimits, ResolvedAttachment } from './types';

const TRUNCATION_MARKER = '\n\n[… truncated by ObsAIde to fit the context budget …]';

function escapeAttribute(value: string): string {
	return value.replace(/"/g, "'");
}

/**
 * Apply the per-note and whole-request character caps.
 *
 * Parts are trimmed in order, so material the user attached first survives when
 * the budget runs out. Once nothing is left, later notes are marked `omitted`
 * rather than silently shrunk to nothing — attaching a large folder must not be
 * able to quietly drop half of itself.
 */
export function applyContextLimits(
	parts: ResolvedAttachment[],
	limits: ContextLimits,
): ResolvedAttachment[] {
	let remaining = Math.max(0, limits.maxContextChars);

	return parts.map((part) => {
		if (part.missing) return part;

		const perNote = truncateText(part.content, Math.max(0, limits.maxCharsPerNote));
		if (remaining <= 0) {
			return { ...part, content: '', truncated: false, omitted: true };
		}

		const budgeted = truncateText(perNote.text, remaining);
		remaining = Math.max(0, remaining - budgeted.text.length);
		return {
			...part,
			content: budgeted.text,
			truncated: part.truncated || perNote.truncated || budgeted.truncated,
		};
	});
}

function describePart(part: ResolvedAttachment): string {
	const attributes: string[] = [`type="${part.kind}"`, `role="${part.role}"`];
	if (part.path) attributes.push(`path="${escapeAttribute(part.path)}"`);
	if (part.folderPath) attributes.push(`folder="${escapeAttribute(part.folderPath)}"`);
	if (part.lines) attributes.push(`lines="${part.lines.from}-${part.lines.to}"`);
	return attributes.join(' ');
}

/**
 * Render attachments as tagged blocks the model can reference precisely.
 *
 * Note boundaries and paths are explicit rather than concatenated, and the
 * preamble states plainly which part is being asked about and which part is
 * only there for background.
 */
export function formatContextBlock(parts: ResolvedAttachment[]): string {
	const included = parts.filter((part) => !part.omitted);
	const omitted = parts.filter((part) => part.omitted);
	if (included.length === 0 && omitted.length === 0) return '';

	// The roles only need explaining when there is actually a mix of them.
	const explainRoles =
		included.some((part) => part.role === 'primary') &&
		included.some((part) => part.role === 'supporting');
	const preamble = explainRoles
		? [
				'The user attached material from their Obsidian vault.',
				'- role="primary" is what the user is asking about. Answer about that.',
				'- role="supporting" is background from the same vault. Use it to resolve references and shorthand in the primary material, but do not summarise or discuss it unless the question needs it.',
			].join('\n')
		: 'The user attached the following Markdown notes from their Obsidian vault. Treat them as the source of truth for this request.';

	const blocks = included.map((part) => {
		const open = `<attachment ${describePart(part)}>`;
		if (part.missing) {
			return `${open}\n[This note is no longer available in the vault.]\n</attachment>`;
		}
		const body = part.truncated ? `${part.content}${TRUNCATION_MARKER}` : part.content;
		return `${open}\n${body}\n</attachment>`;
	});

	if (omitted.length > 0) {
		const paths = omitted
			.map((part) => part.path ?? part.title)
			.join(', ');
		blocks.push(
			`<attachment-omitted count="${omitted.length}">\n${paths}\n</attachment-omitted>`,
		);
		blocks.push(
			'Those notes were left out because the context budget was reached. Say so if the answer depends on them.',
		);
	}

	return [preamble, ...blocks].join('\n\n');
}

/** Combine the context block with what the user typed. */
export function composeUserContent(contextBlock: string, question: string): string {
	const prompt = question.trim();
	if (!contextBlock) return prompt;
	if (!prompt) return contextBlock;
	return `${contextBlock}\n\n${prompt}`;
}

export interface ContextSummary {
	notes: number;
	truncated: number;
	omitted: number;
	characters: number;
}

/** What actually went out, for the transparency line in the transcript. */
export function summarizeContext(parts: readonly ResolvedAttachment[]): ContextSummary {
	return {
		notes: parts.filter((part) => !part.omitted).length,
		truncated: parts.filter((part) => part.truncated).length,
		omitted: parts.filter((part) => part.omitted).length,
		characters: parts.reduce((total, part) => total + part.content.length, 0),
	};
}

/**
 * One line telling the user what the budget cost them, or `undefined` when
 * everything they attached was sent in full.
 */
export function describeContextTrimming(summary: ContextSummary): string | undefined {
	const notes: string[] = [];
	if (summary.truncated > 0) {
		notes.push(`${summary.truncated} ${summary.truncated === 1 ? 'note was' : 'notes were'} shortened`);
	}
	if (summary.omitted > 0) {
		notes.push(`${summary.omitted} ${summary.omitted === 1 ? 'note was' : 'notes were'} left out`);
	}
	if (notes.length === 0) return undefined;
	return `${notes.join(' and ')} to fit the context budget.`;
}
