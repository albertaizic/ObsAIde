import { type App } from 'obsidian';

/** A candidate note for wikilink suggestion. */
export interface WikilinkCandidate {
	/** Vault path of the note. */
	path: string;
	/** Note title (basename without extension). */
	title: string;
	/** Frontmatter aliases if any. */
	aliases: string[];
	/** Headings in the note. */
	headings: string[];
}

/** A suggested wikilink with source context. */
export interface WikilinkSuggestion {
	/** Target note path. */
	targetPath: string;
	/** Target note title. */
	targetTitle: string;
	/** The phrase in source text that matches. */
	sourcePhrase: string;
	/** Confidence score (0-1). */
	confidence: number;
	/** Reason for the suggestion. */
	reason: string;
	/** Optional custom replacement text (e.g., AI-suggested rewrite with wikilink). */
	replacement?: string;
}

/** Options for discovering candidates. */
export interface DiscoverCandidatesOptions {
	/** Maximum number of candidates to return. */
	maxCandidates?: number;
}

/** Discover wikilink candidates from the vault based on source text. */
export async function discoverCandidates(
	app: App,
	sourceText: string,
	options: DiscoverCandidatesOptions = {},
): Promise<WikilinkCandidate[]> {
	const maxCandidates = options.maxCandidates ?? 20;
	const sourceLower = sourceText.toLowerCase();
	const words = sourceLower.split(/\s+/).filter((w) => w.length > 2);

	// Get all markdown files
	const files = app.vault.getMarkdownFiles();
	const candidates: WikilinkCandidate[] = [];

	for (const file of files) {
		try {
			const content = await app.vault.cachedRead(file);
			const frontmatter = extractFrontmatter(content);
			const aliases = frontmatter.aliases
			? (Array.isArray(frontmatter.aliases)
				? frontmatter.aliases.map((a) => String(a))
				: [(frontmatter.aliases as { toString: () => string }).toString()])
			: [];
			const headings = extractHeadings(content);

			candidates.push({
				path: file.path,
				title: file.basename,
				aliases,
				headings,
			});
		} catch {
			// Skip unreadable files
		}
	}

	// Score candidates
	const scored = candidates.map((candidate) => {
		let score = 0;
		const titleLower = candidate.title.toLowerCase();
		const aliasesLower = candidate.aliases.map((a) => a.toLowerCase());
		const headingsLower = candidate.headings.map((h) => h.toLowerCase());

		// Title match - word by word
		for (const word of words) {
			if (titleLower.includes(word)) score += 10;
		}

		// Alias match
		for (const alias of aliasesLower) {
			for (const word of words) {
				if (alias.includes(word)) score += 8;
			}
		}

		// Heading match
		for (const heading of headingsLower) {
			for (const word of words) {
				if (heading.includes(word)) score += 5;
			}
		}

		// Phrase match in title (first 3 words)
		const phrase = words.slice(0, 3).join(' ');
		if (titleLower.includes(phrase)) score += 20;

		return { candidate, score };
	});

	// Filter and sort
	return scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxCandidates)
		.map((s) => s.candidate);
}

/** Generate wikilink suggestions from candidates. */
export function generateSuggestions(
	sourceText: string,
	candidates: WikilinkCandidate[],
	maxSuggestions = 10,
): WikilinkSuggestion[] {
	const suggestions: WikilinkSuggestion[] = [];
	const sourceLower = sourceText.toLowerCase();

	for (const candidate of candidates) {
		const titleLower = candidate.title.toLowerCase();
		const aliasesLower = candidate.aliases.map((a) => a.toLowerCase());

		let bestPhrase = '';
		let bestConfidence = 0;

		// Check title match
		if (sourceLower.includes(titleLower)) {
			bestPhrase = candidate.title;
			bestConfidence = 0.9;
		}

		// Check alias matches
		for (const alias of aliasesLower) {
			if (sourceLower.includes(alias) && alias.length > bestPhrase.length) {
				bestPhrase = alias;
				bestConfidence = 0.85;
			}
		}

		// Check partial word matches
		if (!bestPhrase) {
			const sourceWords = sourceLower.split(/\s+/).filter((w) => w.length > 3);
			for (const word of sourceWords) {
				if (titleLower.includes(word) && word.length > bestPhrase.length) {
					bestPhrase = word;
					bestConfidence = 0.6;
				}
			}
		}

		if (bestPhrase && bestConfidence > 0.3) {
			suggestions.push({
				targetPath: candidate.path,
				targetTitle: candidate.title,
				sourcePhrase: bestPhrase,
				confidence: bestConfidence,
				reason: `Matches "${bestPhrase}" in source text`,
			});
		}
	}

	return suggestions
		.sort((a, b) => b.confidence - a.confidence)
		.slice(0, maxSuggestions);
}

/** Filter out candidates that are already linked in the source text. */
export function filterExistingLinks(
	candidates: WikilinkCandidate[],
	sourceText: string,
): WikilinkCandidate[] {
	// Find all existing wikilinks in source text
	const existingLinks = new Set<string>();
	const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
	let match;
	while ((match = wikilinkRegex.exec(sourceText)) !== null) {
		const linkText = match[1]?.split('|')[0]?.trim() ?? '';
		if (linkText) existingLinks.add(linkText.toLowerCase());
	}

	return candidates.filter((c) => !existingLinks.has(c.title.toLowerCase()));
}

/** Check if a position in text is inside a protected region (code block, inline code, frontmatter, existing link). */
export function isPositionProtected(text: string, index: number): boolean {
	// Check if inside code block
	const beforeText = text.slice(0, index);
	const codeBlockCount = (beforeText.match(/```/g) || []).length;
	if (codeBlockCount % 2 === 1) return true;

	// Check if inside inline code
	const inlineCodeCount = (beforeText.match(/`/g) || []).length;
	if (inlineCodeCount % 2 === 1) return true;

	// Check if inside frontmatter
	const firstDelimiter = text.indexOf('---');
	const secondDelimiter = text.indexOf('---', firstDelimiter + 3);
	if (firstDelimiter === 0 && secondDelimiter !== -1 && index > firstDelimiter && index < secondDelimiter) {
		return true;
	}

	// Check if already inside a wikilink
	const wikilinkStart = beforeText.lastIndexOf('[[');
	const wikilinkEnd = beforeText.lastIndexOf(']]');
	if (wikilinkStart !== -1 && (wikilinkEnd === -1 || wikilinkStart > wikilinkEnd)) {
		return true;
	}

	// Check if inside markdown link [text](url)
	const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
	let linkMatch;
	while ((linkMatch = linkRegex.exec(text)) !== null) {
		const linkStart = linkMatch.index;
		const linkEnd = linkMatch.index + linkMatch[0].length;
		if (index >= linkStart && index <= linkEnd) {
			return true;
		}
	}

	return false;
}

/** Apply a wikilink to the source text at the first occurrence of the source phrase. */
export function applyWikilink(
	text: string,
	sourcePhrase: string,
	targetTitle: string,
): string {
	// Find the source phrase in text (case-insensitive)
	const index = text.toLowerCase().indexOf(sourcePhrase.toLowerCase());
	if (index === -1) return text;

	// Check if position is protected
	if (isPositionProtected(text, index)) return text;

	// Use simple wikilink if phrase matches title case-insensitively
	const matchesIgnoreCase = sourcePhrase.toLowerCase() === targetTitle.toLowerCase();
	const linkText = matchesIgnoreCase
		? `[[${targetTitle}]]`
		: `[[${targetTitle}|${sourcePhrase}]]`;

	return text.slice(0, index) + linkText + text.slice(index + sourcePhrase.length);
}

/** Extract frontmatter from markdown content. */
function extractFrontmatter(content: string): Record<string, unknown> {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch || !frontmatterMatch[1]) return {};

	try {
		const yaml = frontmatterMatch[1];
		const result: Record<string, unknown> = {};
		for (const line of yaml.split('\n')) {
			const colonIndex = line.indexOf(':');
			if (colonIndex > 0) {
				const key = line.slice(0, colonIndex).trim();
				const value = line.slice(colonIndex + 1).trim();
				// Simple parsing - handle arrays
				if (value.startsWith('[') && value.endsWith(']')) {
					result[key] = value.slice(1, -1).split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''));
				} else {
					result[key] = value.replace(/^['"]|['"]$/g, '');
				}
			}
		}
		return result;
	} catch {
		return {};
	}
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