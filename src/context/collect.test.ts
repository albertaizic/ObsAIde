import { describe, expect, it, vi } from 'vitest';
import { isDuplicateAttachment } from './collect';
import type { Attachment } from './types';

// These tests exercise only the pure helpers, but the module also keeps live
// references to Obsidian classes (MarkdownView, TFolder). Stub the Obsidian
// API so importing the module never pulls in a real vault runtime.
vi.mock('obsidian', () => ({}));

/** A whole-note attachment, as captureNote would build it. */
function note(id: string, path: string): Attachment {
	return { id, kind: 'note', path, title: 'Binary Search', role: 'primary' };
}

/** A selection snapshot, as captureSelection would build it. */
function selection(id: string, path: string | undefined, text: string): Attachment {
	return {
		id,
		kind: 'selection',
		path,
		title: 'Selection in Binary Search',
		text,
		lines: { from: 3, to: 7 },
		role: 'supporting',
	};
}

describe('isDuplicateAttachment', () => {
	it('accepts anything into an empty list', () => {
		expect(isDuplicateAttachment([], note('a-1', 'Notes/Search.md'))).toBe(false);
	});

	it('sees the same note attached twice', () => {
		const existing = [note('a-1', 'Notes/Search.md')];
		expect(isDuplicateAttachment(existing, note('a-2', 'Notes/Search.md'))).toBe(true);
	});

	it('does not confuse different kinds at the same path', () => {
		const existing = [note('a-1', 'Notes/Search.md')];
		expect(
			isDuplicateAttachment(existing, selection('a-2', 'Notes/Search.md', 'O(log n)')),
		).toBe(false);
	});

	it('allows notes from different paths', () => {
		const existing = [note('a-1', 'Notes/Search.md')];
		expect(isDuplicateAttachment(existing, note('a-2', 'Notes/Sort.md'))).toBe(false);
	});

	it('treats selections with the same snapshot as duplicates', () => {
		const existing = [selection('a-1', 'Notes/Search.md', 'O(log n)')];
		expect(
			isDuplicateAttachment(existing, selection('a-2', 'Notes/Search.md', 'O(log n)')),
		).toBe(true);
	});

	it('keeps selections whose captured text differs', () => {
		const existing = [selection('a-1', 'Notes/Search.md', 'O(log n)')];
		expect(
			isDuplicateAttachment(existing, selection('a-2', 'Notes/Search.md', 'O(n log n)')),
		).toBe(false);
	});

	it('matches path-less attachments on kind alone', () => {
		const existing = [selection('a-1', undefined, 'unsaved buffer')];
		expect(
			isDuplicateAttachment(existing, selection('a-2', undefined, 'unsaved buffer')),
		).toBe(true);
	});

	it('still compares text when two path-less selections differ', () => {
		const existing = [selection('a-1', undefined, 'first draft')];
		expect(
			isDuplicateAttachment(existing, selection('a-2', undefined, 'second draft')),
		).toBe(false);
	});

	it('ignores stored text for non-selection kinds', () => {
		const stored: Attachment = { ...note('a-1', 'Notes/Search.md'), text: 'old snapshot' };
		const fresh: Attachment = { ...note('a-2', 'Notes/Search.md'), text: 'new content' };
		expect(isDuplicateAttachment([stored], fresh)).toBe(true);
	});
});
