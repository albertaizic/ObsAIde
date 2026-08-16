/** Small text helpers shared by context building and the UI. */

export interface TruncationResult {
	text: string;
	truncated: boolean;
}

/**
 * Cut `text` to at most `limit` characters, preferring a line boundary so we
 * never leave a half-written Markdown construct dangling.
 */
export function truncateText(text: string, limit: number): TruncationResult {
	// A negative limit means "no limit"; zero really does mean nothing fits.
	if (limit < 0 || text.length <= limit) {
		return { text, truncated: false };
	}
	const slice = text.slice(0, limit);
	const lastBreak = slice.lastIndexOf('\n');
	const cut = lastBreak > limit * 0.5 ? slice.slice(0, lastBreak) : slice;
	return { text: cut.trimEnd(), truncated: true };
}

/** Collapse whitespace and clip, for titles, chips and tooltips. */
export function summarize(text: string, limit = 60): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= limit) return flat;
	return `${flat.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Very rough token estimate used only to warn about oversized context.
 * Deliberately provider-agnostic: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Human readable byte-ish size for context chips. */
export function formatApproxTokens(text: string): string {
	const tokens = estimateTokens(text);
	if (tokens < 1000) return `~${tokens} tokens`;
	return `~${(tokens / 1000).toFixed(1)}k tokens`;
}
