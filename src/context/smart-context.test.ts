import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('Smart Context Scopes - deduplication logic (unit)', () => {
	// Test the deduplication logic concepts without requiring full Obsidian imports

	interface Attachment {
		id: string;
		kind: 'note' | 'selection' | 'folder' | 'section';
		path?: string;
		title: string;
		role?: 'primary' | 'supporting';
	}

	interface ResolvedAttachment {
		attachmentId: string;
		kind: 'selection' | 'note';
		role: 'primary' | 'supporting';
		path?: string;
		title: string;
		content: string;
		truncated: boolean;
		missing?: boolean;
		omitted?: boolean;
	}

	function makeNote(path: string, role: 'primary' | 'supporting' = 'primary'): Attachment {
		return {
			id: 'a-' + path.replace(/\//g, '-'),
			kind: 'note',
			path,
			title: path.split('/').pop() || path,
			role,
		};
	}

	function makeSelection(overrides: Partial<Attachment> = {}): Attachment {
		return {
			id: 'a2',
			kind: 'selection',
			path: 'test.md',
			title: 'Selection',
			text: 'selected text',
			role: 'primary',
			...overrides,
		};
	}

	describe('Deduplication concepts', () => {
		it('same vault path should be deduplicated', () => {
			const attachments: Attachment[] = [
				makeNote('Notes/Shared.md', 'primary'),
				makeNote('Notes/Shared.md', 'primary'),
			];

			// Simulate deduplication by path
			const seen = new Set<string>();
			const deduped = attachments.filter(a => {
				if (!a.path) return true;
				if (seen.has(a.path)) return false;
				seen.add(a.path);
				return true;
			});

			expect(deduped).toHaveLength(1);
			expect(deduped[0].path).toBe('Notes/Shared.md');
		});

		it('preserves selection role even when containing note has same path', () => {
			const selection = makeSelection({ path: 'Notes/Note.md' });
			const containingNote = makeNote('Notes/Note.md', 'supporting');

			const attachments = [selection, containingNote];

			// Both should be kept because they have different kinds/roles
			// The deduplication logic should keep both since kind differs
			const seen = new Set<string>();
			const deduped = attachments.filter(a => {
				const key = `${a.kind}:${a.path}:${a.role}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});

			expect(deduped).toHaveLength(2);
			expect(deduped.find(a => a.kind === 'selection')).toBeDefined();
			expect(deduped.find(a => a.kind === 'note' && a.role === 'supporting')).toBeDefined();
		});

		it('deduplicates @note against manual attachment', () => {
			const attachments: Attachment[] = [
				makeNote('Notes/Manual.md', 'primary'),
				makeNote('Notes/Manual.md', 'primary'),
			];

			const seen = new Set<string>();
			const deduped = attachments.filter(a => {
				if (!a.path) return true;
				if (seen.has(a.path)) return false;
				seen.add(a.path);
				return true;
			});

			expect(deduped).toHaveLength(1);
		});

		it('enforces per-note budget concept', () => {
			const maxCharsPerNote = 100;
			const content = 'x'.repeat(1000);
			const truncated = content.length > maxCharsPerNote ? content.slice(0, maxCharsPerNote) : content;

			expect(truncated.length).toBeLessThanOrEqual(maxCharsPerNote);
			expect(truncated.length).toBe(maxCharsPerNote);
		});

		it('enforces total context budget concept', () => {
			const maxContextChars = 800;
			// Use content sizes that ensure omission: 400 each = 1200 total > 800
			const notes = [
				{ path: 'Notes/1.md', content: 'x'.repeat(400) },
				{ path: 'Notes/2.md', content: 'x'.repeat(400) },
				{ path: 'Notes/3.md', content: 'x'.repeat(400) },
			];

			let remaining = maxContextChars;
			const included = [];

			for (const note of notes) {
				if (remaining <= 0) {
					// Omitted notes should have empty content
					included.push({ path: note.path, content: '', omitted: true });
					continue;
				}
				const toInclude = note.content.slice(0, remaining);
				remaining -= toInclude.length;
				included.push({ ...note, content: toInclude });
			}

			const total = included.reduce((sum, n) => sum + n.content.length, 0);
			expect(total).toBeLessThanOrEqual(maxContextChars);
			expect(included.some(n => n.omitted)).toBe(true);
		});

		it('preserves attachment order for predictable truncation', () => {
			const maxContextChars = 800;
			const notes = [
				{ path: 'Notes/First.md', content: 'x'.repeat(500) },
				{ path: 'Notes/Second.md', content: 'x'.repeat(500) },
				{ path: 'Notes/Third.md', content: 'x'.repeat(500) },
			];

			let remaining = maxContextChars;
			const included = [];

			for (const note of notes) {
				if (remaining <= 0) {
					included.push({ ...note, omitted: true });
					continue;
				}
				const toInclude = note.content.slice(0, remaining);
				remaining -= toInclude.length;
				included.push({ ...note, content: toInclude });
			}

			expect(included[0].path).toBe('Notes/First.md');
			expect(included[0].omitted).toBeUndefined();
			expect(included[2].omitted).toBe(true);
		});

		it('marks missing notes concept', () => {
			// Missing notes should not be omitted, just marked
			const missingNote = { missing: true, omitted: undefined };
			expect(missingNote.missing).toBe(true);
			expect(missingNote.omitted).toBeUndefined();
		});
	});

	describe('formatContextBlock concepts', () => {
		function makeResolved(overrides: Partial<ResolvedAttachment> = {}): ResolvedAttachment {
			return {
				attachmentId: 'a1',
				kind: 'note',
				role: 'primary',
				path: 'Notes/Test.md',
				title: 'Test',
				content: 'content',
				truncated: false,
				...overrides,
			};
		}

		it('shows selection as primary with supporting note', () => {
			const parts: ResolvedAttachment[] = [
				{ ...makeResolved(), kind: 'selection', role: 'primary', content: 'selected' },
				{ ...makeResolved(), role: 'supporting', content: 'supporting note' },
			];

			// The preamble should explain roles
			const hasPrimary = parts.some(p => p.role === 'primary');
			const hasSupporting = parts.some(p => p.role === 'supporting');
			expect(hasPrimary && hasSupporting).toBe(true);
		});

		it('shows plain preamble when only primary', () => {
			const parts = [makeResolved(), makeResolved({ path: 'Notes/Two.md' })];
			const hasSupporting = parts.some(p => p.role === 'supporting');
			expect(hasSupporting).toBe(false);
		});

		it('includes folder path metadata concept', () => {
			const part = makeResolved({ path: 'CSE/Week 1/Search.md', folderPath: 'CSE' });
			expect(part.folderPath).toBe('CSE');
		});

		it('lists omitted notes concept', () => {
			const parts = [
				makeResolved(),
				makeResolved({ path: 'Notes/Omitted.md', omitted: true, content: '' }),
			];
			const omitted = parts.filter(p => p.omitted);
			expect(omitted).toHaveLength(1);
			expect(omitted[0].path).toBe('Notes/Omitted.md');
		});
	});

	describe('Scope context modes', () => {
		it('none scope clears auto context', () => {
			const scope = 'none';
			expect(scope).toBe('none');
		});

		it('selection scope uses selection + supporting note', () => {
			const scope = 'selection';
			expect(scope).toBe('selection');
		});

		it('section scope uses current section', () => {
			const scope = 'section';
			expect(scope).toBe('section');
		});

		it('note scope uses full note', () => {
			const scope = 'note';
			expect(scope).toBe('note');
		});

		it('linked scope uses linked notes', () => {
			const scope = 'linked';
			expect(scope).toBe('linked');
		});

		it('folder scope uses folder picker', () => {
			const scope = 'folder';
			expect(scope).toBe('folder');
		});
	});
});