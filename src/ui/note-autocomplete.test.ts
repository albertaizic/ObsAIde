import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('NoteAutocomplete - logic concepts', () => {
	// Test the logical concepts without full Obsidian integration

	interface NoteCandidate {
		file: { path: string; basename: string };
		displayPath: string;
		name: string;
	}

	interface NoteAttachment {
		id: string;
		kind: 'note';
		path: string;
		title: string;
		role: 'primary' | 'supporting';
	}

	describe('findTrigger logic', () => {
		function findTrigger(text: string): { position: number; query: string } | null {
			const matches = [...text.matchAll(/(^|\s)@([^\s@]*)$/g)];
			if (matches.length === 0) return null;

			const lastMatch = matches[matches.length - 1];
			if (!lastMatch) return null;
			const fullMatch = lastMatch[0];
			const query = lastMatch[2] || '';
			const matchIndex = text.lastIndexOf(fullMatch) + (fullMatch.length - query.length - 1);
			return { position: matchIndex, query };
		}

		it('finds @ at start of text', () => {
			const result = findTrigger('@bin');
			expect(result).toEqual({ position: 0, query: 'bin' });
		});

		it('finds @ after whitespace', () => {
			const result = findTrigger('Compare @bin');
			expect(result).toEqual({ position: 8, query: 'bin' });
		});

		it('finds last @ when multiple', () => {
			const result = findTrigger('@first @second');
			expect(result).toEqual({ position: 7, query: 'second' });
		});

		it('returns null when no @', () => {
			const result = findTrigger('no trigger here');
			expect(result).toBeNull();
		});

		it('returns null when @ is mid-word', () => {
			const result = findTrigger('email@domain.com');
			expect(result).toBeNull();
		});

		it('handles @ with empty query', () => {
			const result = findTrigger('test @');
			expect(result).toEqual({ position: 5, query: '' });
		});
	});

	describe('filtering logic', () => {
		const candidates: NoteCandidate[] = [
			{ file: { path: 'Algorithms/Binary Search.md', basename: 'Binary Search' }, displayPath: 'Algorithms/Binary Search.md', name: 'Binary Search' },
			{ file: { path: 'Interview Prep/Binary Search.md', basename: 'Binary Search' }, displayPath: 'Interview Prep/Binary Search.md', name: 'Binary Search' },
			{ file: { path: 'Data Structures/Linked List.md', basename: 'Linked List' }, displayPath: 'Data Structures/Linked List.md', name: 'Linked List' },
			{ file: { path: 'Notes/Quick Sort.md', basename: 'Quick Sort' }, displayPath: 'Notes/Quick Sort.md', name: 'Quick Sort' },
		];

		function filterCandidates(candidates: NoteCandidate[], query: string): NoteCandidate[] {
			if (!query) return candidates;
			const q = query.toLowerCase().trim();
			return candidates.filter(c =>
				c.displayPath.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
			);
		}

		it('returns all candidates when query empty', () => {
			expect(filterCandidates(candidates, '')).toHaveLength(4);
		});

		it('filters by path', () => {
			const result = filterCandidates(candidates, 'algo');
			expect(result).toHaveLength(1);
			expect(result[0].displayPath).toBe('Algorithms/Binary Search.md');
		});

		it('filters by name', () => {
			const result = filterCandidates(candidates, 'binary');
			expect(result).toHaveLength(2);
		});

		it('is case insensitive', () => {
			const result = filterCandidates(candidates, 'BINARY');
			expect(result).toHaveLength(2);
		});
	});

	describe('selection logic', () => {
		const candidates: NoteCandidate[] = [
			{ file: { path: 'a.md', basename: 'A' }, displayPath: 'a.md', name: 'A' },
			{ file: { path: 'b.md', basename: 'B' }, displayPath: 'b.md', name: 'B' },
		];

		let idCounter = 0;
		function selectHighlighted(highlightedIndex: number, candidates: NoteCandidate[]): NoteAttachment | null {
			if (highlightedIndex < 0 || highlightedIndex >= candidates.length) return null;
			const candidate = candidates[highlightedIndex];
			return {
				id: `a-${++idCounter}`,
				kind: 'note',
				path: candidate.file.path,
				title: candidate.name,
				role: 'primary',
			};
		}

		it('creates attachment with stable path identity', () => {
			const attachment = selectHighlighted(0, candidates);
			expect(attachment).toEqual(
				expect.objectContaining({
					kind: 'note',
					path: 'a.md',
					title: 'A',
					role: 'primary',
				}),
			);
		});

		it('generates unique ID', () => {
			idCounter = 0; // Reset for this test
			const attachment1 = selectHighlighted(0, candidates);
			const attachment2 = selectHighlighted(0, candidates);
			expect(attachment1.id).not.toBe(attachment2.id);
		});
	});

	describe('duplicate filenames', () => {
		const candidates: NoteCandidate[] = [
			{ file: { path: 'Algorithms/Binary Search.md', basename: 'Binary Search' }, displayPath: 'Algorithms/Binary Search.md', name: 'Binary Search' },
			{ file: { path: 'Interview Prep/Binary Search.md', basename: 'Binary Search' }, displayPath: 'Interview Prep/Binary Search.md', name: 'Binary Search' },
			{ file: { path: 'Data Structures/Linked List.md', basename: 'Linked List' }, displayPath: 'Data Structures/Linked List.md', name: 'Linked List' },
		];

		it('distinguishes Binary Search in different folders', () => {
			const binarySearch = candidates.filter(c => c.name === 'Binary Search');
			expect(binarySearch).toHaveLength(2);
			expect(binarySearch[0].displayPath).toBe('Algorithms/Binary Search.md');
			expect(binarySearch[1].displayPath).toBe('Interview Prep/Binary Search.md');
		});
	});

	describe('existing attachments tracking', () => {
		const existingAttachments: NoteAttachment[] = [
			{ id: 'a1', kind: 'note', path: 'Algorithms/Binary Search.md', title: 'Binary Search', role: 'primary' },
		];

		const candidates: NoteCandidate[] = [
			{ file: { path: 'Algorithms/Binary Search.md', basename: 'Binary Search' }, displayPath: 'Algorithms/Binary Search.md', name: 'Binary Search' },
			{ file: { path: 'Interview Prep/Binary Search.md', basename: 'Binary Search' }, displayPath: 'Interview Prep/Binary Search.md', name: 'Binary Search' },
		];

		function markExisting(candidates: NoteCandidate[], existing: NoteAttachment[]) {
			const existingPaths = new Set(existing.map(a => a.path));
			return candidates.map(c => ({
				...c,
				isExisting: existingPaths.has(c.file.path),
			}));
		}

		it('marks existing attachments', () => {
			const marked = markExisting(candidates, existingAttachments);
			expect(marked[0].isExisting).toBe(true);
			expect(marked[1].isExisting).toBe(false);
		});
	});
});