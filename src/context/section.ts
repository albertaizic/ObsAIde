import { type App, type Editor, TFile } from 'obsidian';
import { createId } from '../utils/id';
import type { SectionAttachment } from './types';

/** Represents a Markdown heading with its level and position. */
export interface Heading {
	level: number; // 1-6
	text: string;
	line: number; // 0-based line number
}

/** Represents a Markdown section (heading + content until next same/higher level heading). */
export interface MarkdownSection {
	heading: Heading;
	content: string;
	startLine: number; // 0-based inclusive
	endLine: number; // 0-based exclusive
	subsections: MarkdownSection[];
	parent: MarkdownSection | null;
}

/**
 * Parse all headings from Markdown content.
 */
export function parseHeadings(content: string): Heading[] {
	const lines = content.split('\n');
	const headings: Heading[] = [];

	for (let i = 0; i < lines.length; i++) {
		const currentLine = lines[i];
		if (!currentLine) continue;
		const match = currentLine.match(/^(#{1,6})\s+(.+)$/);
		if (!match) continue;
		const hashes = match[1];
		const text = match[2];
		if (!hashes || !text) continue;
		headings.push({ level: hashes.length, text: text.trim(), line: i });
	}

	return headings;
}

/**
 * Build a section tree from headings.
 *
 * `endLine` is the section's *container* boundary — it runs until the next
 * heading at the same or higher level, so it spans every nested subsection
 * too. This is what cursor hit-testing (`findSectionAtCursor`) relies on: a
 * cursor anywhere inside "Binary Search", including inside its "Complexity"
 * subsection, must be recognised as inside "Binary Search". `content`, by
 * contrast, is only the text directly under the heading, stopping at its
 * first child — that boundary is computed separately below.
 */
export function buildSectionTree(headings: Heading[], lines: string[]): MarkdownSection[] {
	const sections: MarkdownSection[] = [];
	const stack: (MarkdownSection & { heading: Heading })[] = [];

	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		if (!heading) continue;

		// Container boundary: the next heading at the same or higher level,
		// wherever it is in the flat heading list, or end of file.
		let containerEnd = lines.length;
		for (let j = i + 1; j < headings.length; j++) {
			const next = headings[j];
			if (next && next.level <= heading.level) {
				containerEnd = next.line;
				break;
			}
		}

		const section: MarkdownSection & { heading: Heading } = {
			heading,
			content: '',
			startLine: heading.line,
			endLine: containerEnd,
			subsections: [],
			parent: null,
		};

		// Find parent (last heading with lower level)
		while (stack.length > 0) {
			const last = stack[stack.length - 1];
			if (!last || last.heading.level < heading.level) break;
			stack.pop();
		}

		if (stack.length > 0) {
			// Add as subsection of parent
			const parent = stack[stack.length - 1];
			if (parent) {
				section.parent = parent;
				parent.subsections.push(section);
			}
		} else {
			// Top-level section
			sections.push(section);
		}

		stack.push(section);
	}

	// Own content stops at the first child, independent of the container span.
	for (const section of sections) {
		calculateSectionContent(section, lines);
	}

	return sections;
}

function calculateSectionContent(section: MarkdownSection, lines: string[]): void {
	const start = section.startLine + 1; // Content starts after heading
	const end = section.subsections.length > 0 ? section.subsections[0]!.startLine : section.endLine;

	section.content = lines.slice(start, end).join('\n').trim();

	// Recurse for subsections
	for (const sub of section.subsections) {
		calculateSectionContent(sub, lines);
	}
}

/**
 * Find the section containing the given cursor position.
 * Returns the deepest matching section.
 */
export function findSectionAtCursor(
	sections: MarkdownSection[],
	cursorLine: number,
): MarkdownSection | null {
	let result: MarkdownSection | null = null;

	for (const section of sections) {
		if (cursorLine >= section.startLine && cursorLine < section.endLine) {
			result = section;
			// Check subsections for a deeper match
			const subMatch = findSectionAtCursor(section.subsections, cursorLine);
			if (subMatch) result = subMatch;
		}
	}

	return result;
}

/**
 * Get the breadcrumb path for a section (e.g., "Algorithms › Binary Search › Complexity").
 * Uses the parent reference for efficient breadcrumb generation.
 */
export function getSectionBreadcrumb(section: MarkdownSection): string {
	const path: Heading[] = [];
	let current: MarkdownSection | null = section;

	while (current) {
		if (current.heading) {
			path.unshift(current.heading);
		}
		current = current.parent;
	}

	return path.map((h) => h.text).join(' › ');
}

/**
 * Get the full breadcrumb by walking up the section tree.
 *
 * Prefers the `parent` reference when present (fast path for trees built by
 * `buildSectionTree`), but falls back to searching `rootSections` so callers
 * that construct a `MarkdownSection` tree without wiring `parent` (e.g. tests)
 * still get a correct breadcrumb.
 */
export function getSectionBreadcrumbFull(
	rootSections: MarkdownSection[],
	target: MarkdownSection,
): string {
	if (target.parent) return getSectionBreadcrumb(target);

	const path: Heading[] = [];

	function findPath(sections: MarkdownSection[], node: MarkdownSection): boolean {
		for (const section of sections) {
			if (!section.heading) continue;
			path.push(section.heading);
			if (section === node) return true;
			if (findPath(section.subsections, node)) return true;
			path.pop();
		}
		return false;
	}

	if (!findPath(rootSections, target)) return getSectionBreadcrumb(target);
	return path.map((h) => h.text).join(' › ');
}

/**
 * Extract the current Markdown section from the editor.
 * Returns the section content with its heading, parent intro, and subsections.
 * Excludes sibling sections.
 */
export function extractCurrentSection(
	app: App,
	editor: Editor,
	file: TFile | null,
): { section: MarkdownSection | null; breadcrumb: string; fullContent: string } {
	if (!file) {
		return { section: null, breadcrumb: '', fullContent: editor.getValue() };
	}

	const content = editor.getValue();
	const lines = content.split('\n');
	const headings = parseHeadings(content);

	if (headings.length === 0) {
		// No headings - return whole note as fallback
		return {
			section: {
				heading: { level: 0, text: file.basename, line: -1 },
				content: content.trim(),
				startLine: 0,
				endLine: lines.length,
				subsections: [],
				parent: null,
			},
			breadcrumb: file.basename,
			fullContent: content,
		};
	}

	const sections = buildSectionTree(headings, lines);
	const cursorLine = editor.getCursor('from').line;

	const section = findSectionAtCursor(sections, cursorLine);

	if (!section) {
		// Cursor is before first heading - return content before first heading
		const firstHeading = headings[0];
		if (!firstHeading) {
			return {
				section: null,
				breadcrumb: file.basename,
				fullContent: content,
			};
		}
		const firstHeadingLine = firstHeading.line;
		const beforeContent = lines.slice(0, firstHeadingLine).join('\n').trim();
		// If there's no meaningful content before the first heading, report no section
		if (!beforeContent) {
			return {
				section: null,
				breadcrumb: 'No section at cursor',
				fullContent: content,
			};
		}
		return {
			section: {
				heading: { level: 0, text: 'Before first heading', line: -1 },
				content: beforeContent,
				startLine: 0,
				endLine: firstHeadingLine,
				subsections: [],
				parent: null,
			},
			breadcrumb: file.basename + ' › (before first heading)',
			fullContent: content,
		};
	}

	const breadcrumb = getSectionBreadcrumbFull(sections, section);

	// Build full section content with:
	// 1. Heading ancestry context (parent introductory text)
	// 2. Current section heading + content
	// 3. Subsections of current section
	// EXCLUDES: sibling sections

	let fullSectionContent = '';

	// Add parent introductory text (content between parent heading and first child)
	const parentIntro = getParentIntroductoryText(section, lines);
	if (parentIntro) {
		fullSectionContent += `${parentIntro}\n\n`;
	}

	// Add current section heading and content
	fullSectionContent += `${'#'.repeat(section.heading.level)} ${section.heading.text}\n\n`;
	fullSectionContent += section.content;

	// Include subsections of current section
	for (const sub of section.subsections) {
		fullSectionContent += `\n\n${'#'.repeat(sub.heading.level)} ${sub.heading.text}\n\n${sub.content}`;
	}

	return {
		section,
		breadcrumb,
		fullContent: fullSectionContent.trim(),
	};
}

/**
 * Get the introductory text of the parent section (text between parent heading
 * and its first child heading). Returns empty string if no parent or no intro.
 */
function getParentIntroductoryText(section: MarkdownSection, lines: string[]): string {
	if (!section.parent) return '';

	const parent = section.parent;
	const start = parent.startLine + 1; // After parent heading
	const firstSub = parent.subsections[0];
	const end = firstSub ? firstSub.startLine : parent.endLine;

	const introLines = lines.slice(start, end);
	const intro = introLines.join('\n').trim();

	if (!intro) return '';

	// Format as the parent heading with its intro text
	const headingLine = `${'#'.repeat(parent.heading.level)} ${parent.heading.text}`;
	return `${headingLine}\n\n${intro}`;
}

/**
 * Extract the section as a context attachment.
 */
export function createSectionAttachment(
	app: App,
	editor: Editor,
	file: TFile | null,
	role: 'primary' | 'supporting' = 'primary',
): SectionAttachment | null {
	if (!file) return null;

	const { section, breadcrumb, fullContent } = extractCurrentSection(app, editor, file);

	if (!section || !fullContent.trim()) return null;

	return {
		id: createId('a-'),
		kind: 'section',
		path: file.path,
		title: `Section: ${section.heading.text}`,
		breadcrumb,
		content: fullContent,
		role,
	};
}