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

/** Characters Obsidian forbids in note names on every platform. */
const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*]/g;

/** Replace characters that cannot appear in a note name with dashes. */
export function sanitizeNoteName(name: string): string {
	return name.replace(FORBIDDEN_NAME_CHARS, '-');
}

/**
 * Strip one surrounding Markdown code fence.
 *
 * Models habitually wrap JSON payloads in fences despite instructions; both
 * structured-response parsers run through here first.
 */
export function stripCodeFence(text: string): string {
	let body = text.trim();
	if (!body.startsWith('```')) return body;
	const fenceEnd = body.indexOf('\n');
	if (fenceEnd === -1) return body;
	body = body.slice(fenceEnd + 1);
	const endFence = body.lastIndexOf('```');
	return endFence !== -1 ? body.slice(0, endFence) : body;
}

/**
 * First unused `folderPath/name.md`, trying `name 1.md`, `name 2.md`, …
 *
 * `exists` is injected so callers hand it `vault.getAbstractFileByPath` and
 * tests can run without Obsidian.
 */
export function uniqueNotePath(
	folderPath: string,
	name: string,
	exists: (path: string) => boolean,
): string {
	let counter = 1;
	let candidate = `${folderPath}/${name}.md`;
	while (exists(candidate)) {
		candidate = `${folderPath}/${name} ${counter}.md`;
		counter++;
	}
	return candidate;
}
