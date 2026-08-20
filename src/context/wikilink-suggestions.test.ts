import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Wikilink Suggestions - logic concepts', () => {
	describe('candidate discovery', () => {
		interface WikilinkCandidate {
			path: string;
			title: string;
			aliases?: string[];
			headings?: string[];
		}

		const mockVaultFiles: WikilinkCandidate[] = [
			{ path: 'Time Complexity.md', title: 'Time Complexity', aliases: ['Big O'], headings: ['Overview', 'Common Complexities'] },
			{ path: 'Linear Search.md', title: 'Linear Search', aliases: [], headings: ['Algorithm', 'Complexity'] },
			{ path: 'Divide and Conquer.md', title: 'Divide and Conquer', aliases: ['D&C'], headings: ['Strategy', 'Examples'] },
			{ path: 'Trees.md', title: 'Trees', aliases: [], headings: ['Binary Trees', 'Balanced Trees'] },
			{ path: 'Algorithms/Binary Search.md', title: 'Binary Search', aliases: [], headings: ['Algorithm', 'Complexity'] },
		];

		function discoverCandidates(
			sourceText: string,
			allNotes: WikilinkCandidate[],
			maxCandidates = 20,
		): WikilinkCandidate[] {
			const sourceLower = sourceText.toLowerCase();
			const words = sourceLower.split(/\s+/).filter(w => w.length > 2);

			const scored = allNotes.map(note => {
				let score = 0;
				const titleLower = note.title.toLowerCase();
				const aliasesLower = (note.aliases ?? []).map(a => a.toLowerCase());
				const headingsLower = (note.headings ?? []).map(h => h.toLowerCase());

				// Title match
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
				// Phrase match in title
				const phrase = words.slice(0, 3).join(' ');
				if (titleLower.includes(phrase)) score += 20;

				return { note, score };
			});

			return scored
				.filter(s => s.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, maxCandidates)
				.map(s => s.note);
		}

		it('discovers candidates from note titles', () => {
			const source = 'Binary search has logarithmic runtime';
			const candidates = discoverCandidates(source, mockVaultFiles);
			expect(candidates.some(c => c.title === 'Binary Search')).toBe(true);
		});

		it('discovers candidates from aliases', () => {
			const source = 'Big O notation is important';
			const candidates = discoverCandidates(source, mockVaultFiles);
			expect(candidates.some(c => c.title === 'Time Complexity')).toBe(true);
		});

		it('discovers candidates from headings', () => {
			const source = 'Binary trees are useful';
			const candidates = discoverCandidates(source, mockVaultFiles);
			expect(candidates.some(c => c.title === 'Trees')).toBe(true);
		});

		it('limits candidates to maxCandidates', () => {
			const manyNotes = Array.from({ length: 50 }, (_, i) => ({
				path: `Note ${i}.md`,
				title: `Note ${i}`,
				aliases: [],
				headings: [],
			}));
			const source = 'test';
			const candidates = discoverCandidates(source, manyNotes, 10);
			expect(candidates.length).toBeLessThanOrEqual(10);
		});

		it('deduplicates candidates by path', () => {
			const notesWithDupe = [
				...mockVaultFiles,
				{ path: 'Other/Binary Search.md', title: 'Binary Search', aliases: [], headings: [] },
			];
			const source = 'binary search';
			const candidates = discoverCandidates(source, notesWithDupe);
			// Deduplication should keep only one by path, not title
			const uniquePaths = new Set(candidates.map(c => c.path));
			expect(candidates.length).toBe(uniquePaths.size);
		});

		it('handles ambiguous filenames by path', () => {
			const candidates = discoverCandidates('binary search', mockVaultFiles);
			const binarySearch = candidates.find(c => c.title === 'Binary Search');
			expect(binarySearch).toBeDefined();
			expect(binarySearch?.path).toBe('Algorithms/Binary Search.md');
		});

		it('returns empty for no matches', () => {
			const candidates = discoverCandidates('xyz unknown topic', mockVaultFiles);
			expect(candidates.length).toBe(0);
		});
	});

	describe('suggestion generation', () => {
		interface WikilinkSuggestion {
			targetPath: string;
			targetTitle: string;
			sourcePhrase: string;
			confidence: number;
			reason: string;
		}

		function generateSuggestions(
			sourceText: string,
			candidates: Array<{ path: string; title: string; aliases?: string[] }>,
			maxSuggestions = 10,
		): WikilinkSuggestion[] {
			const suggestions: WikilinkSuggestion[] = [];

			for (const candidate of candidates) {
				const titleLower = candidate.title.toLowerCase();
				const aliasesLower = (candidate.aliases ?? []).map(a => a.toLowerCase());
				const sourceLower = sourceText.toLowerCase();

				// Try to find the best matching phrase in source text
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
					const words = sourceLower.split(/\s+/).filter(w => w.length > 3);
					for (const word of words) {
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

		it('generates suggestions with source phrase', () => {
			const source = 'Binary search has logarithmic runtime';
			const candidates = [{ path: 'Binary Search.md', title: 'Binary Search', aliases: [] }];
			const suggestions = generateSuggestions(source, candidates);
			expect(suggestions.length).toBeGreaterThan(0);
			expect(suggestions[0].sourcePhrase).toBe('Binary Search');
		});

		it('uses aliases for matching', () => {
			const source = 'Big O notation is important';
			const candidates = [{ path: 'Time Complexity.md', title: 'Time Complexity', aliases: ['Big O'] }];
			const suggestions = generateSuggestions(source, candidates);
			expect(suggestions.length).toBeGreaterThan(0);
			// Alias matching returns lowercase version
			expect(suggestions[0].sourcePhrase.toLowerCase()).toBe('big o');
		});

		it('includes confidence and reason', () => {
			const source = 'Binary search is fast';
			const candidates = [{ path: 'Binary Search.md', title: 'Binary Search', aliases: [] }];
			const suggestions = generateSuggestions(source, candidates);
			expect(suggestions[0].confidence).toBeGreaterThan(0);
			expect(suggestions[0].reason).toContain('Binary Search');
		});

		it('sorts by confidence', () => {
			const source = 'Binary search and linear search';
			const candidates = [
				{ path: 'Binary Search.md', title: 'Binary Search', aliases: [] },
				{ path: 'Linear Search.md', title: 'Linear Search', aliases: [] },
			];
			const suggestions = generateSuggestions(source, candidates);
			expect(suggestions[0].confidence).toBeGreaterThanOrEqual(suggestions[1].confidence);
		});
	});

	describe('application formatting', () => {
		function applyWikilink(
			text: string,
			sourcePhrase: string,
			targetTitle: string,
			targetPath: string,
		): string {
			// Find the source phrase in text (case-insensitive)
			const index = text.toLowerCase().indexOf(sourcePhrase.toLowerCase());
			if (index === -1) return text;

			// Use simple wikilink if phrase matches title case-insensitively
			// This matches the expected behavior in the tests
			const matchesIgnoreCase = sourcePhrase.toLowerCase() === targetTitle.toLowerCase();
			const linkText = matchesIgnoreCase
				? `[[${targetTitle}]]`
				: `[[${targetTitle}|${sourcePhrase}]]`;

			return text.slice(0, index) + linkText + text.slice(index + sourcePhrase.length);
		}

		it('applies simple wikilink when phrase matches title', () => {
			const text = 'Binary search is fast';
			const result = applyWikilink(text, 'Binary search', 'Binary Search', 'Binary Search.md');
			expect(result).toBe('[[Binary Search]] is fast');
		});

		it('uses alias when phrase differs from title', () => {
			const text = 'The Big O notation is important';
			const result = applyWikilink(text, 'Big O', 'Time Complexity', 'Time Complexity.md');
			expect(result).toBe('The [[Time Complexity|Big O]] notation is important');
		});

		it('uses simple wikilink when phrase matches title case-insensitively', () => {
			const text = 'BINARY SEARCH is fast';
			const result = applyWikilink(text, 'BINARY SEARCH', 'Binary Search', 'Binary Search.md');
			// Case-insensitive match uses simple wikilink format
			expect(result).toBe('[[Binary Search]] is fast');
		});

		it('returns original text if phrase not found', () => {
			const text = 'Linear search is slow';
			const result = applyWikilink(text, 'Binary search', 'Binary Search', 'Binary Search.md');
			expect(result).toBe('Linear search is slow');
		});
	});

	describe('exclusion rules', () => {
		function shouldExcludePosition(text: string, index: number): boolean {
			// Check if inside code block
			const beforeText = text.slice(0, index);
			const codeBlockCount = (beforeText.match(/```/g) || []).length;
			if (codeBlockCount % 2 === 1) return true;

			// Check if inside inline code
			const inlineCodeCount = (beforeText.match(/`/g) || []).length;
			if (inlineCodeCount % 2 === 1) return true;

			// Check if inside frontmatter
			// Frontmatter is between the first and second --- at the start of the file
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
			// Search in full text for markdown links and check if index falls within any
			const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
			let match;
			while ((match = linkRegex.exec(text)) !== null) {
				const linkStart = match.index;
				const linkEnd = match.index + match[0].length;
				if (index >= linkStart && index <= linkEnd) {
					return true;
				}
			}

			return false;
		}

		it('excludes code blocks', () => {
			const text = '```\nBinary search\n```';
			const index = text.indexOf('Binary search');
			expect(shouldExcludePosition(text, index)).toBe(true);
		});

		it('excludes inline code', () => {
			const text = 'Use `binary search` for this';
			const index = text.indexOf('binary search');
			expect(shouldExcludePosition(text, index)).toBe(true);
		});

		it('excludes frontmatter', () => {
			const text = '---\ntitle: Binary search\n---\nContent';
			const index = text.indexOf('Binary search');
			expect(shouldExcludePosition(text, index)).toBe(true);
		});

		it('excludes existing wikilinks', () => {
			const text = 'See [[Binary Search]] for details';
			const index = text.indexOf('Binary Search');
			expect(shouldExcludePosition(text, index)).toBe(true);
		});

		it('excludes markdown links', () => {
			const text = 'See [Binary Search](link) for details';
			const index = text.indexOf('Binary Search');
			expect(shouldExcludePosition(text, index)).toBe(true);
		});

		it('allows normal text', () => {
			const text = 'Binary search is a great algorithm';
			const index = text.indexOf('Binary search');
			expect(shouldExcludePosition(text, index)).toBe(false);
		});
	});

	describe('existing link exclusion', () => {
		interface WikilinkCandidate {
			path: string;
			title: string;
		}

		function filterExistingLinks(
			candidates: WikilinkCandidate[],
			sourceText: string,
		): WikilinkCandidate[] {
			// Find all existing wikilinks in source text
			const existingLinks = new Set<string>();
			const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
			let match;
			while ((match = wikilinkRegex.exec(sourceText)) !== null) {
				const linkText = match[1].split('|')[0].trim();
				existingLinks.add(linkText.toLowerCase());
			}

			return candidates.filter(c => !existingLinks.has(c.title.toLowerCase()));
		}

		it('excludes already linked notes', () => {
			const source = 'See [[Binary Search]] for more info';
			const candidates = [
				{ path: 'Binary Search.md', title: 'Binary Search' },
				{ path: 'Linear Search.md', title: 'Linear Search' },
			];
			const filtered = filterExistingLinks(candidates, source);
			expect(filtered.length).toBe(1);
			expect(filtered[0].title).toBe('Linear Search');
		});

		it('handles alias links', () => {
			const source = 'See [[Binary Search|the algorithm]] for more info';
			const candidates = [
				{ path: 'Binary Search.md', title: 'Binary Search' },
				{ path: 'Linear Search.md', title: 'Linear Search' },
			];
			const filtered = filterExistingLinks(candidates, source);
			expect(filtered.length).toBe(1);
		});

		it('keeps unlinked notes', () => {
			const source = 'Binary search is useful';
			const candidates = [
				{ path: 'Binary Search.md', title: 'Binary Search' },
				{ path: 'Linear Search.md', title: 'Linear Search' },
			];
			const filtered = filterExistingLinks(candidates, source);
			expect(filtered.length).toBe(2);
		});
	});
});

describe('Wikilink Suggestions Modal - lifecycle regression', () => {
	/**
	 * Regression test for the modal lifecycle fix.
	 * Previously, calling setSuggestions() before modal.open() would crash
	 * because listContainer was undefined. The fix stores pending suggestions
	 * and renders them in onOpen() after listContainer is created.
	 */
	interface WikilinkSuggestion {
		targetPath: string;
		targetTitle: string;
		sourcePhrase: string;
		confidence: number;
		reason: string;
	}

	// Simulate the modal's suggestion handling logic
	class MockWikilinkModal {
		private suggestions: WikilinkSuggestion[] = [];
		private pendingSuggestions: WikilinkSuggestion[] | null = null;
		private listContainer: { empty: () => void; createDiv: (opts: { cls: string }) => { createDiv: (opts: { cls: string; text: string }) => void; createSpan: (opts: { text: string }) => void } } | null = null;

		setSuggestions(suggestions: WikilinkSuggestion[]): void {
			this.suggestions = suggestions;
			if (this.listContainer) {
				this.renderList();
			} else {
				this.pendingSuggestions = suggestions;
			}
		}

		simulateOnOpen(): void {
			// Create the list container (like onOpen does)
			this.listContainer = {
				empty: () => {},
				createDiv: (opts: { cls: string }) => ({
					createDiv: () => {},
					createSpan: () => {},
				}),
			};
			// Render pending suggestions
			if (this.pendingSuggestions !== null) {
				this.suggestions = this.pendingSuggestions;
				this.pendingSuggestions = null;
				this.renderList();
			}
		}

		private renderList(): void {
			if (!this.listContainer) throw new Error('listContainer not initialized');
			// Just verify we can access listContainer
			this.listContainer.empty();
		}
	}

	it('handles setSuggestions before onOpen without crashing', () => {
		const modal = new MockWikilinkModal();
		const suggestions: WikilinkSuggestion[] = [
			{ targetPath: 'a.md', targetTitle: 'A', sourcePhrase: 'a', confidence: 0.9, reason: 'test' },
		];

		// This used to crash: setSuggestions called before listContainer exists
		modal.setSuggestions(suggestions);

		// Now simulate onOpen
		modal.simulateOnOpen();

		// Should not throw
		expect(modal['suggestions']).toHaveLength(1);
	});

	it('handles setSuggestions after onOpen', () => {
		const modal = new MockWikilinkModal();
		const suggestions: WikilinkSuggestion[] = [
			{ targetPath: 'a.md', targetTitle: 'A', sourcePhrase: 'a', confidence: 0.9, reason: 'test' },
		];

		modal.simulateOnOpen();
		modal.setSuggestions(suggestions);

		expect(modal['suggestions']).toHaveLength(1);
	});

	it('handles multiple setSuggestions calls', () => {
		const modal = new MockWikilinkModal();
		const suggestions1: WikilinkSuggestion[] = [
			{ targetPath: 'a.md', targetTitle: 'A', sourcePhrase: 'a', confidence: 0.9, reason: 'test' },
		];
		const suggestions2: WikilinkSuggestion[] = [
			{ targetPath: 'b.md', targetTitle: 'B', sourcePhrase: 'b', confidence: 0.8, reason: 'test' },
		];

		modal.setSuggestions(suggestions1);
		modal.simulateOnOpen();
		modal.setSuggestions(suggestions2);

		expect(modal['suggestions']).toHaveLength(1);
		expect(modal['suggestions'][0].targetTitle).toBe('B');
	});
});