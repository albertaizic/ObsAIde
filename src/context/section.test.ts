import { describe, expect, it } from 'vitest';
import {
	parseHeadings,
	buildSectionTree,
	findSectionAtCursor,
	getSectionBreadcrumbFull,
	extractCurrentSection,
	createSectionAttachment,
	type MarkdownSection,
	type Heading,
} from './section';

function makeHeading(level: number, text: string, line: number): Heading {
	return { level, text, line };
}

function makeSection(
	heading: Heading,
	content: string,
	startLine: number,
	endLine: number,
	subsections: MarkdownSection[] = [],
): MarkdownSection {
	return { heading, content, startLine, endLine, subsections };
}

describe('parseHeadings', () => {
	it('parses H1', () => {
		const headings = parseHeadings('# Title\n\nContent');
		expect(headings).toEqual([makeHeading(1, 'Title', 0)]);
	});

	it('parses H2', () => {
		const headings = parseHeadings('## Subtitle\n\nContent');
		expect(headings).toEqual([makeHeading(2, 'Subtitle', 0)]);
	});

	it('parses H3', () => {
		const headings = parseHeadings('### Sub-subtitle\n\nContent');
		expect(headings).toEqual([makeHeading(3, 'Sub-subtitle', 0)]);
	});

	it('parses multiple headings', () => {
		const content = '# H1\n\n## H2\n\n### H3\n\n## H2 again';
		const headings = parseHeadings(content);
		expect(headings).toHaveLength(4);
		expect(headings[0]).toEqual(makeHeading(1, 'H1', 0));
		expect(headings[1]).toEqual(makeHeading(2, 'H2', 2));
		expect(headings[2]).toEqual(makeHeading(3, 'H3', 4));
		expect(headings[3]).toEqual(makeHeading(2, 'H2 again', 6));
	});

	it('ignores non-heading lines', () => {
		const headings = parseHeadings('Just text\n\n# Real heading\n\nMore text');
		expect(headings).toEqual([makeHeading(1, 'Real heading', 2)]);
	});

	it('handles empty content', () => {
		expect(parseHeadings('')).toEqual([]);
		expect(parseHeadings('   \n\n  ')).toEqual([]);
	});
});

describe('buildSectionTree', () => {
	it('creates single section for single heading', () => {
		const headings = [makeHeading(1, 'Title', 0)];
		const lines = ['# Title', 'Content'];
		const sections = buildSectionTree(headings, lines);
		expect(sections).toHaveLength(1);
		expect(sections[0].heading).toEqual(makeHeading(1, 'Title', 0));
		expect(sections[0].content).toBe('Content');
		expect(sections[0].startLine).toBe(0);
		expect(sections[0].endLine).toBe(2);
	});

	it('nests H3 under H2 under H1', () => {
		const headings = [
			makeHeading(1, 'H1', 0),
			makeHeading(2, 'H2', 2),
			makeHeading(3, 'H3', 4),
		];
		const lines = ['# H1', 'H1 content', '## H2', 'H2 content', '### H3', 'H3 content'];
		const sections = buildSectionTree(headings, lines);

		expect(sections).toHaveLength(1);
		const h1 = sections[0];
		expect(h1.subsections).toHaveLength(1);
		const h2 = h1.subsections[0];
		expect(h2.subsections).toHaveLength(1);
		const h3 = h2.subsections[0];
		expect(h3.heading.text).toBe('H3');
	});

	it('stops at next same-level heading', () => {
		const headings = [
			makeHeading(2, 'First H2', 2),
			makeHeading(2, 'Second H2', 6),
		];
		const lines = [
			'# H1', 'content', '## First H2', 'first', 'more', '## Second H2', 'second',
		];
		const sections = buildSectionTree(headings, lines);

		expect(sections).toHaveLength(2);
		expect(sections[0].endLine).toBe(6); // Before second H2 (line 6)
		expect(sections[1].startLine).toBe(6);
	});

	it('stops at higher-level heading', () => {
		const headings = [
			makeHeading(2, 'H2', 2),
			makeHeading(1, 'New H1', 6),
		];
		const lines = ['# H1', 'content', '## H2', 'subsection', '## more', '# New H1', 'new'];
		const sections = buildSectionTree(headings, lines);

		expect(sections).toHaveLength(2);
		expect(sections[0].endLine).toBe(6); // Before New H1 (line 6)
		expect(sections[1].startLine).toBe(6);
	});

	it('gives a top-level section the same container span whether or not it has children', () => {
		// Regression test: a section's `endLine` (used for cursor hit-testing)
		// must reach the next *sibling*, not stop at its own first child. A
		// section with a deeply nested last child previously "leaked" past that
		// child's end because only the section's own subsections were consulted.
		const headings = [
			makeHeading(1, 'Algorithms', 0),
			makeHeading(2, 'Binary Search', 1),
			makeHeading(3, 'Complexity', 3),
			makeHeading(2, 'Linear Search', 5),
		];
		const lines = [
			'# Algorithms', '## Binary Search', 'BS body', '### Complexity', 'O(log n)',
			'## Linear Search', 'LS body',
		];
		const sections = buildSectionTree(headings, lines);
		const algorithms = sections[0]!;
		const binarySearch = algorithms.subsections[0]!;
		const complexity = binarySearch.subsections[0]!;

		// Binary Search's container must reach Linear Search (line 5), not stop
		// at Complexity's own start (line 3).
		expect(binarySearch.endLine).toBe(5);
		expect(complexity.endLine).toBe(5);
		// A cursor on Complexity's content line (4, "O(log n)") must resolve to
		// Complexity, not fall through because Binary Search's container
		// excluded it.
		expect(findSectionAtCursor(sections, 4)?.heading.text).toBe('Complexity');
	});

	it('handles content before first heading', () => {
		const headings = [makeHeading(1, 'Title', 2)];
		const lines = ['Before heading', 'more before', '# Title', 'after'];
		const sections = buildSectionTree(headings, lines);

		// The section tree doesn't include pre-heading content
		// extractCurrentSection handles that case
		expect(sections[0].startLine).toBe(2);
	});
});

describe('findSectionAtCursor', () => {
	const sections: MarkdownSection[] = [
		makeSection(
			makeHeading(1, 'Algorithms', 0),
			'Intro',
			0,
			15,
			[
				makeSection(
					makeHeading(2, 'Binary Search', 2),
					'BS content',
					2,
					10,
					[
						makeSection(makeHeading(3, 'Complexity', 4), 'O(log n)', 4, 7, []),
						makeSection(makeHeading(3, 'Implementation', 7), 'code', 7, 10, []),
					],
				),
				makeSection(makeHeading(2, 'Linear Search', 10), 'LS content', 10, 15, []),
			],
		),
	];

	it('finds H1 section', () => {
		const section = findSectionAtCursor(sections, 1);
		expect(section?.heading.text).toBe('Algorithms');
	});

	it('finds H2 section', () => {
		const section = findSectionAtCursor(sections, 3);
		expect(section?.heading.text).toBe('Binary Search');
	});

	it('finds nested H3 section', () => {
		const section = findSectionAtCursor(sections, 5);
		expect(section?.heading.text).toBe('Complexity');
	});

	it('finds second H2 section', () => {
		const section = findSectionAtCursor(sections, 12);
		expect(section?.heading.text).toBe('Linear Search');
	});

	it('returns null for cursor before first heading', () => {
		const sectionsWithPre: MarkdownSection[] = [
			makeSection(makeHeading(1, 'Title', 2), 'content', 2, 4, []),
		];
		const section = findSectionAtCursor(sectionsWithPre, 1);
		expect(section).toBeNull();
	});
});

describe('getSectionBreadcrumbFull', () => {
	const sections: MarkdownSection[] = [
		makeSection(
			makeHeading(1, 'Algorithms', 0),
			'',
			0,
			20,
			[
				makeSection(
					makeHeading(2, 'Binary Search', 2),
					'',
					2,
					10,
					[makeSection(makeHeading(3, 'Complexity', 4), '', 4, 7, [])],
				),
			],
		),
	];

	it('builds breadcrumb for nested section', () => {
		const target = sections[0].subsections[0].subsections[0];
		const breadcrumb = getSectionBreadcrumbFull(sections, target);
		expect(breadcrumb).toBe('Algorithms › Binary Search › Complexity');
	});

	it('builds breadcrumb for H2', () => {
		const target = sections[0].subsections[0];
		const breadcrumb = getSectionBreadcrumbFull(sections, target);
		expect(breadcrumb).toBe('Algorithms › Binary Search');
	});

	it('builds breadcrumb for H1', () => {
		const target = sections[0];
		const breadcrumb = getSectionBreadcrumbFull(sections, target);
		expect(breadcrumb).toBe('Algorithms');
	});
});

function makeEditor(content: string, cursorLine: number): any {
	return {
		getValue: () => content,
		getCursor: () => ({ line: cursorLine, ch: 0 }),
	};
}

const ALGORITHMS_NOTE = [
	'# Algorithms',
	'',
	'## Binary Search',
	'',
	'Binary search halves the search space.',
	'',
	'### Complexity',
	'',
	'O(log n).',
	'',
	'## Linear Search',
	'',
	'Checks every item.',
].join('\n');

describe('extractCurrentSection', () => {
	it('returns whole note when the note has no headings at all', () => {
		const editor = makeEditor('Just some text.\nNo headings here.', 0);
		const result = extractCurrentSection(null as any, editor, { path: 'x.md', basename: 'x' } as any);
		expect(result.section?.heading.text).toBe('x');
		expect(result.fullContent).toBe('Just some text.\nNo headings here.');
	});

	it('resolves the deepest section and breadcrumb at the cursor', () => {
		const cursorLine = ALGORITHMS_NOTE.split('\n').indexOf('O(log n).');
		const editor = makeEditor(ALGORITHMS_NOTE, cursorLine);
		const result = extractCurrentSection(
			null as any,
			editor,
			{ path: 'Algorithms.md', basename: 'Algorithms' } as any,
		);
		expect(result.breadcrumb).toBe('Algorithms › Binary Search › Complexity');
		expect(result.fullContent).toContain('### Complexity');
		expect(result.fullContent).toContain('O(log n).');
		expect(result.fullContent).not.toContain('Linear Search');
	});

	it('includes nested subsections when the cursor is in the parent section body', () => {
		const cursorLine = ALGORITHMS_NOTE.split('\n').indexOf(
			'Binary search halves the search space.',
		);
		const editor = makeEditor(ALGORITHMS_NOTE, cursorLine);
		const result = extractCurrentSection(
			null as any,
			editor,
			{ path: 'Algorithms.md', basename: 'Algorithms' } as any,
		);
		expect(result.breadcrumb).toBe('Algorithms › Binary Search');
		expect(result.fullContent).toContain('### Complexity');
		expect(result.fullContent).not.toContain('Linear Search');
	});

	it('reports no section when the cursor is before the first heading with no content there', () => {
		const content = '\n\n# Title\n\ncontent';
		const editor = makeEditor(content, 0);
		const result = extractCurrentSection(null as any, editor, { path: 'x.md', basename: 'x' } as any);
		expect(result.section).toBeNull();
		expect(result.breadcrumb).toBe('No section at cursor');
	});

	it('does not fall back to the whole note when the cursor is before the first heading', () => {
		const content = 'Some intro text.\n\n# Title\n\ncontent';
		const editor = makeEditor(content, 0);
		const result = extractCurrentSection(null as any, editor, { path: 'x.md', basename: 'x' } as any);
		expect(result.section?.content).toBe('Some intro text.');
		expect(result.fullContent).toBe(content);
	});
});

describe('createSectionAttachment', () => {
	it('creates an attachment with a stable id and the resolved breadcrumb', () => {
		const cursorLine = ALGORITHMS_NOTE.split('\n').indexOf('O(log n).');
		const editor = makeEditor(ALGORITHMS_NOTE, cursorLine);
		const attachment = createSectionAttachment(
			null as any,
			editor,
			{ path: 'Algorithms.md', basename: 'Algorithms' } as any,
			'primary',
		);
		expect(attachment).not.toBeNull();
		expect(attachment?.id).toBeTruthy();
		expect(attachment?.kind).toBe('section');
		expect(attachment?.breadcrumb).toBe('Algorithms › Binary Search › Complexity');
	});

	it('returns null when there is no file', () => {
		const editor = makeEditor('# H1\ncontent', 0);
		expect(createSectionAttachment(null as any, editor, null, 'primary')).toBeNull();
	});

	it('returns null when the cursor has no usable section', () => {
		const editor = makeEditor('\n# Title\ncontent', 0);
		expect(
			createSectionAttachment(null as any, editor, { path: 'x.md', basename: 'x' } as any, 'primary'),
		).toBeNull();
	});
});