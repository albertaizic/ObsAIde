import { type App } from 'obsidian';

/**
 * Result of a vault search.
 */
export interface VaultSearchResult {
	/** Vault path of the note. */
	path: string;
	/** Note title (basename without extension). */
	title: string;
	/** Short snippet showing the match context. */
	snippet: string;
	/** Heading where the match was found, if applicable. */
	matchedHeading?: string;
	/** Relevance score (higher = more relevant). */
	score: number;
}

/** In-memory search index entry for a note. */
interface SearchIndexEntry {
	title: string;
	path: string;
	content: string;
	headings: string[];
	mtime: number;
}

/** In-memory search index. */
let searchIndexCache: Map<string, SearchIndexEntry> | null = null;
let indexBuiltAt = 0;
const INDEX_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a lightweight in-memory search index from the vault's Markdown files.
 *
 * The index is cached for INDEX_TTL_MS and rebuilt on demand. Vault events
 * could invalidate it, but for simplicity we rely on TTL and manual refresh.
 */
export async function buildSearchIndex(app: App): Promise<Map<string, SearchIndexEntry>> {
	const now = Date.now();
	if (searchIndexCache && now - indexBuiltAt < INDEX_TTL_MS) {
		return searchIndexCache;
	}

	const index = new Map<string, SearchIndexEntry>();
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		try {
			const content = await app.vault.cachedRead(file);
			const headings = extractHeadings(content);

			index.set(file.path, {
				title: file.basename,
				path: file.path,
				content,
				headings,
				mtime: file.stat.mtime,
			});
		} catch {
			// Skip unreadable files
		}
	}

	searchIndexCache = index;
	indexBuiltAt = now;
	return index;
}

/** Extract headings from markdown content. */
function extractHeadings(content: string): string[] {
	const headings: string[] = [];
	const lines = content.split('\n');
	for (const line of lines) {
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match && match[2]) {
			headings.push(match[2].trim());
		}
	}
	return headings;
}

/** Clear the search index cache (e.g., after vault changes). */
export function clearSearchIndex(): void {
	searchIndexCache = null;
	indexBuiltAt = 0;
}

/**
 * Search the vault index for the given query.
 *
 * Ranking priority:
 * 1. Title exact/phrase match
 * 2. Heading exact/phrase match
 * 3. Path match
 * 4. Content keyword match (all terms must appear)
 * 5. Recency (mtime) as tiebreaker
 */
export function searchIndex(
	index: Map<string, SearchIndexEntry>,
	query: string,
): VaultSearchResult[] {
	const terms = normalizeQuery(query);
	if (terms.length === 0) return [];

	const results: VaultSearchResult[] = [];

	for (const entry of index.values()) {
		const score = scoreEntry(entry, terms);
		if (score > 0) {
			const { snippet, matchedHeading } = findBestSnippet(entry, terms);
			results.push({
				path: entry.path,
				title: entry.title,
				snippet,
				matchedHeading,
				score,
			});
		}
	}

	// Sort by score descending, then by recency descending
	results.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const aEntry = index.get(a.path);
		const bEntry = index.get(b.path);
		return (bEntry?.mtime ?? 0) - (aEntry?.mtime ?? 0);
	});

	return results;
}

/** Normalize query into search terms. */
function normalizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ') // Replace punctuation with spaces
		.split(/\s+/)
		.filter((term) => term.length > 0);
}

/** Score an index entry against search terms. */
function scoreEntry(entry: SearchIndexEntry, terms: string[]): number {
	let score = 0;
	const titleLower = entry.title.toLowerCase();
	const pathLower = entry.path.toLowerCase();
	const contentLower = entry.content.toLowerCase();
	const headingsLower = entry.headings.map((h) => h.toLowerCase());

	// Check if all terms match somewhere (AND logic)
	const allTermsMatch = terms.every(
		(term) =>
			titleLower.includes(term) ||
			pathLower.includes(term) ||
			contentLower.includes(term) ||
			headingsLower.some((h) => h.includes(term)),
	);

	if (!allTermsMatch) return 0;

	// Title exact phrase match (highest)
	const queryPhrase = terms.join(' ');
	if (titleLower.includes(queryPhrase)) {
		score += 1000;
	} else if (terms.every((t) => titleLower.includes(t))) {
		score += 500; // All terms in title
	} else if (terms.some((t) => titleLower.includes(t))) {
		score += 100; // At least one term in title
	}

	// Heading matches
	for (const heading of headingsLower) {
		if (heading.includes(queryPhrase)) {
			score += 300;
			break;
		} else if (terms.every((t) => heading.includes(t))) {
			score += 150;
			break;
		} else if (terms.some((t) => heading.includes(t))) {
			score += 50;
			break;
		}
	}

	// Path match
	if (pathLower.includes(queryPhrase)) {
		score += 100;
	} else if (terms.every((t) => pathLower.includes(t))) {
		score += 50;
	}

	// Content matches (lower weight)
	const contentMatches = terms.filter((t) => contentLower.includes(t)).length;
	score += contentMatches * 10;

	// Phrase match in content
	if (contentLower.includes(queryPhrase)) {
		score += 50;
	}

	return score;
}

/** Find the best snippet and matched heading for display. */
function findBestSnippet(
	entry: SearchIndexEntry,
	terms: string[],
): { snippet: string; matchedHeading?: string } {
	const lines = entry.content.split('\n');
	const queryPhrase = terms.join(' ');

	// Try to find a line with phrase match first
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const lineLower = line.toLowerCase();
		if (lineLower.includes(queryPhrase)) {
			return { snippet: truncateSnippet(line), matchedHeading: findHeadingAtLine(entry, i) };
		}
	}

	// Try to find a line with most term matches
	let bestLine = -1;
	let bestMatchCount = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const lineLower = line.toLowerCase();
		const matchCount = terms.filter((t) => lineLower.includes(t)).length;
		if (matchCount > bestMatchCount) {
			bestMatchCount = matchCount;
			bestLine = i;
		}
	}

	if (bestLine >= 0) {
		const line = lines[bestLine];
		return { snippet: truncateSnippet(line ?? ''), matchedHeading: findHeadingAtLine(entry, bestLine) };
	}

	// Fallback: first heading or first content line
	if (entry.headings.length > 0) {
		const heading = entry.headings[0];
		if (heading) return { snippet: truncateSnippet(heading), matchedHeading: heading };
	}

	const firstContentLine = lines.find((l) => l && l.trim().length > 0) ?? '';
	return { snippet: truncateSnippet(firstContentLine) };
}

/** Find the heading that contains the given line number. */
function findHeadingAtLine(entry: SearchIndexEntry, lineIndex: number): string | undefined {
	const lines = entry.content.split('\n');
	let currentHeading: string | undefined;
	for (let i = 0; i <= lineIndex && i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match && match[2]) {
			currentHeading = match[2].trim();
		}
	}
	return currentHeading;
}

/** Truncate snippet to reasonable length. */
function truncateSnippet(text: string, maxLen = 160): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLen) return trimmed;
	return trimmed.slice(0, maxLen - 1).trimEnd() + '…';
}

/**
 * High-level vault search function.
 *
 * Builds/uses the index and returns ranked results.
 */
export async function searchVault(
	app: App,
	query: string,
	options?: { limit?: number },
): Promise<VaultSearchResult[]> {
	const index = await buildSearchIndex(app);
	const results = searchIndex(index, query);
	const limit = options?.limit ?? 50;
	return results.slice(0, limit);
}