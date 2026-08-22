import { type App } from 'obsidian';
import { stripCodeFence } from '../utils/text';

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

/** A wikilink proposal parsed from the model's structured JSON reply. */
export interface WikilinkProposal {
	/** Exact phrase in the target note the proposal wants to link. */
	targetPhrase: string;
	/** Title of the note to link to. */
	linkTarget: string;
	/** Replacement text containing the wikilink, or a rewritten sentence. */
	replacement: string;
	/** Why this connection is meaningful. */
	reason: string;
	confidence: 'high' | 'medium' | 'low';
}

const CONFIDENCE_LEVELS: readonly WikilinkProposal['confidence'][] = ['high', 'medium', 'low'];

/**
 * Parse the model's reply into proposals, dropping every entry that does not
 * satisfy the shape exactly. A reply that is not JSON at all yields an empty
 * list — the caller reports "no connections found" rather than guessing.
 */
export function parseWikilinkProposals(response: string): WikilinkProposal[] {
	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
		const parsed: { suggestions?: unknown } = JSON.parse(stripCodeFence(response));
		if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) return [];

		return (parsed.suggestions as unknown[])
			.map((entry): WikilinkProposal | null => {
				if (typeof entry !== 'object' || entry === null) return null;
				const s = entry as Record<string, unknown>;
				if (
					typeof s['targetPhrase'] !== 'string' ||
					typeof s['linkTarget'] !== 'string' ||
					typeof s['replacement'] !== 'string' ||
					typeof s['reason'] !== 'string' ||
					typeof s['confidence'] !== 'string' ||
					!CONFIDENCE_LEVELS.includes(s['confidence'] as WikilinkProposal['confidence'])
				) {
					return null;
				}
				return {
					targetPhrase: s['targetPhrase'],
					linkTarget: s['linkTarget'],
					replacement: s['replacement'],
					reason: s['reason'],
					confidence: s['confidence'] as WikilinkProposal['confidence'],
				};
			})
			.filter((proposal): proposal is WikilinkProposal => proposal !== null);
	} catch {
		return [];
	}
}

/**
 * Whether a proposal's replacement already carries a wikilink of its own.
 * Deliberately shallow: the model is told to propose replacements containing
 * links, so any bracketed replacement is treated as already-linked and shown
 * to the user rather than double-processed.
 */
export function isProposalAlreadyLinked(proposal: Pick<WikilinkProposal, 'replacement'>): boolean {
	return proposal.replacement.includes('[') && proposal.replacement.includes(']');
}

/** What the setup modal has selected, expressed as counts. */
export interface WikilinkSelectionCounts {
	targetCount: number;
	sourceNoteCount: number;
	sourceFolderCount: number;
}

/**
 * The single authority on whether analysis may start: at least one target,
 * at least one source (a note OR a folder OR the vault root — a folder is
 * never required), and nothing currently running. The Analyze button and any
 * other gate must ask this; do not re-derive the rule in the UI.
 */
export function canAnalyzeWikilinks(
	counts: WikilinkSelectionCounts,
	isAnalyzing = false,
): boolean {
	if (isAnalyzing) return false;
	if (counts.targetCount < 1) return false;
	return counts.sourceNoteCount + counts.sourceFolderCount >= 1;
}

export interface SourcePlan {
	/** Canonical, deduplicated paths whose content should be read. */
	paths: string[];
	/** Sum of planned file sizes. */
	totalChars: number;
	/** How many candidate notes were left out by the budget. */
	omittedCount: number;
}

export interface SourcePlanInput {
	/** Directly picked source notes, in pick order. */
	sourceNotePaths: readonly string[];
	/** Markdown paths expanded from source folders / vault root. */
	folderNotePaths: readonly string[];
	/** Target notes: supplied to the model separately, excluded here. */
	targetPaths: readonly string[];
	maxTotalChars: number;
	/** File size lookup that must not read content (metadata only). */
	sizeOf: (path: string) => number;
}

/**
 * Decide what gets read BEFORE anything is read: canonicalize and deduplicate
 * paths once, drop targets (their content already travels as the target),
 * then greedily take notes in order until the character budget is spent.
 *
 * A note larger than the entire budget is skipped rather than blocking the
 * smaller notes behind it. Deterministic: same inputs, same plan.
 */
export function planSourceReads(input: SourcePlanInput): SourcePlan {
	const seen = new Set<string>();
	const targets = new Set(input.targetPaths);
	const ordered: string[] = [];
	for (const path of [...input.sourceNotePaths, ...input.folderNotePaths]) {
		if (seen.has(path) || targets.has(path)) continue;
		seen.add(path);
		ordered.push(path);
	}

	let totalChars = 0;
	let omittedCount = 0;
	const paths: string[] = [];
	for (const path of ordered) {
		const size = Math.max(0, input.sizeOf(path));
		if (totalChars + size > input.maxTotalChars) {
			omittedCount++;
			continue;
		}
		totalChars += size;
		paths.push(path);
	}
	return { paths, totalChars, omittedCount };
}