import { describe, expect, it } from 'vitest';
import { dedupeLinkedNotes, type ResolvedLink } from './linked-notes';

function link(overrides: Partial<ResolvedLink> = {}): ResolvedLink {
	return {
		sourcePath: 'Binary Search.md',
		sourceTitle: 'Binary Search',
		targetPath: 'Sorted Data.md',
		targetTitle: 'Sorted Data',
		isMarkdown: true,
		...overrides,
	};
}

describe('dedupeLinkedNotes', () => {
	it('lists resolved Markdown links from an attached note', () => {
		const links = [
			link({ targetPath: 'Sorted Data.md', targetTitle: 'Sorted Data' }),
			link({ targetPath: 'Linear Search.md', targetTitle: 'Linear Search' }),
		];
		const result = dedupeLinkedNotes(links, new Set());
		expect(result.map((c) => c.path)).toEqual(['Linear Search.md', 'Sorted Data.md']);
	});

	it('drops unresolved links', () => {
		const links = [link({ targetPath: null, isMarkdown: false })];
		expect(dedupeLinkedNotes(links, new Set())).toEqual([]);
	});

	it('drops non-Markdown link targets', () => {
		const links = [link({ targetPath: 'diagram.png', isMarkdown: false })];
		expect(dedupeLinkedNotes(links, new Set())).toEqual([]);
	});

	it('excludes already-attached notes', () => {
		const links = [link({ targetPath: 'Sorted Data.md' })];
		const result = dedupeLinkedNotes(links, new Set(['Sorted Data.md']));
		expect(result).toEqual([]);
	});

	it('excludes a self-link back to the source note', () => {
		const links = [link({ targetPath: 'Binary Search.md', sourcePath: 'Binary Search.md' })];
		expect(dedupeLinkedNotes(links, new Set())).toEqual([]);
	});

	it('deduplicates the same target linked from multiple source notes', () => {
		const links = [
			link({ sourcePath: 'Binary Search.md', sourceTitle: 'Binary Search', targetPath: 'Sorted Data.md' }),
			link({ sourcePath: 'Quick Sort.md', sourceTitle: 'Quick Sort', targetPath: 'Sorted Data.md' }),
		];
		const result = dedupeLinkedNotes(links, new Set());
		expect(result).toHaveLength(1);
		expect(result[0]!.sourceTitles).toEqual(['Binary Search', 'Quick Sort']);
	});

	it('does not duplicate a source title for repeated links from the same note', () => {
		const links = [
			link({ targetPath: 'Sorted Data.md' }),
			link({ targetPath: 'Sorted Data.md' }),
		];
		const result = dedupeLinkedNotes(links, new Set());
		expect(result[0]!.sourceTitles).toEqual(['Binary Search']);
	});

	it('unions links across multiple attached source notes', () => {
		const links = [
			link({ sourcePath: 'Binary Search.md', sourceTitle: 'Binary Search', targetPath: 'Sorted Data.md' }),
			link({ sourcePath: 'Quick Sort.md', sourceTitle: 'Quick Sort', targetPath: 'Pivot Selection.md', targetTitle: 'Pivot Selection' }),
		];
		const result = dedupeLinkedNotes(links, new Set());
		expect(result.map((c) => c.path).sort()).toEqual(['Pivot Selection.md', 'Sorted Data.md']);
	});

	it('returns an empty list for a note with no links', () => {
		expect(dedupeLinkedNotes([], new Set())).toEqual([]);
	});
});
