import { type App, type Editor, TFile } from 'obsidian';

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
 */
export function buildSectionTree(headings: Heading[], lines: string[]): MarkdownSection[] {
	const sections: MarkdownSection[] = [];
	const stack: (MarkdownSection & { heading: Heading })[] = [];

	for (const heading of headings) {
		const section: MarkdownSection & { heading: Heading } = {
			heading,
			content: '',
			startLine: heading.line,
			endLine: lines.length,
			subsections: [],
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
			if (parent) parent.subsections.push(section);
		} else {
			// Top-level section
			sections.push(section);
		}

		stack.push(section);
	}

	// Calculate content for each section
	for (const section of sections) {
		calculateSectionContent(section, lines);
	}

	return sections;
}

function calculateSectionContent(section: MarkdownSection, lines: string[]): void {
	const start = section.startLine + 1; // Content starts after heading
	let end = section.endLine;

	// Find the end of this section (next same/higher level heading)
	for (const sub of section.subsections) {
		if (sub.startLine < end) {
			end = sub.startLine;
		}
	}

	section.endLine = end;
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
 */
export function getSectionBreadcrumb(section: MarkdownSection): string {
	let current: MarkdownSection | null = section;
	const stack: MarkdownSection[] = [];

	while (current) {
		stack.push(current);
		// Find parent by checking which section contains this one
		// This is a simplification - in reality we'd track parents
		current = null;
	}

	// Since we don't track parents, we'll build from the root
	// For now, just return the heading text
	return section.heading.text;
}

/**
 * Get the full breadcrumb by walking up the section tree.
 * This requires the root sections to find the path.
 */
export function getSectionBreadcrumbFull(
	rootSections: MarkdownSection[],
	target: MarkdownSection,
): string {
	const path: Heading[] = [];

	function findPath(sections: MarkdownSection[], target: MarkdownSection): boolean {
		for (const section of sections) {
			if (!section.heading) continue;
			path.push(section.heading);
			if (section === target) return true;
			if (findPath(section.subsections, target)) return true;
			path.pop();
		}
		return false;
	}

	findPath(rootSections, target);
	return path.map((h) => h.text).join(' › ');
}

/**
 * Extract the current Markdown section from the editor.
 * Returns the section content with its heading, or the whole note if no headings.
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
		return {
			section: {
				heading: { level: 0, text: 'Before first heading', line: -1 },
				content: beforeContent,
				startLine: 0,
				endLine: firstHeadingLine,
				subsections: [],
			},
			breadcrumb: file.basename + ' › (before first heading)',
			fullContent: content,
		};
	}

	const breadcrumb = getSectionBreadcrumbFull(sections, section);

	// Build full section content including heading and subsections
	let fullSectionContent = `#{'#'.repeat(section.heading.level)} ${section.heading.text}\n\n`;
	fullSectionContent += section.content;

	// Include subsections
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
 * Extract the section as a context attachment.
 */
export interface SectionAttachment {
	kind: 'section';
	path: string;
	title: string;
	breadcrumb: string;
	content: string;
	role: 'primary' | 'supporting';
}

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
		kind: 'section',
		path: file.path,
		title: `Section: ${section.heading.text}`,
		breadcrumb,
		content: fullContent,
		role,
	};
}