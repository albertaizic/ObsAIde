import { describe, expect, it } from 'vitest';
import {
	describeNoteCount,
	folderDisplayName,
	isInsideFolder,
	isMarkdownPath,
	selectFolderNotePaths,
} from './folder';

/** The vault used by the folder acceptance checks. */
const VAULT = [
	'Aide Test/Binary Search.md',
	'Aide Test/Complexity.md',
	'Aide Test/Searching/Linear Search.md',
	'Aide Test/Searching/Search Notes.md',
	'Aide Test/diagram.png',
	'Aide Testing/Unrelated.md',
	'Other/Notes.md',
];

describe('isMarkdownPath', () => {
	it('accepts Markdown only', () => {
		expect(isMarkdownPath('a/b.md')).toBe(true);
		expect(isMarkdownPath('a/b.MD')).toBe(true);
		expect(isMarkdownPath('a/b.png')).toBe(false);
		expect(isMarkdownPath('a/b.markdown')).toBe(false);
		expect(isMarkdownPath('a/b.md.png')).toBe(false);
	});
});

describe('isInsideFolder', () => {
	it('matches nested paths at any depth', () => {
		expect(isInsideFolder('CSE/Week 1/Searching.md', 'CSE')).toBe(true);
		expect(isInsideFolder('CSE/Algorithms.md', 'CSE')).toBe(true);
	});

	it('does not match a folder that merely shares a prefix', () => {
		expect(isInsideFolder('Aide Testing/Unrelated.md', 'Aide Test')).toBe(false);
	});

	it('treats the vault root as everything', () => {
		expect(isInsideFolder('Anything.md', '')).toBe(true);
		expect(isInsideFolder('Anything.md', '/')).toBe(true);
	});
});

describe('selectFolderNotePaths', () => {
	it('collects Markdown recursively and ignores everything else', () => {
		expect(selectFolderNotePaths(VAULT, 'Aide Test')).toEqual([
			'Aide Test/Binary Search.md',
			'Aide Test/Complexity.md',
			'Aide Test/Searching/Linear Search.md',
			'Aide Test/Searching/Search Notes.md',
		]);
	});

	it('never includes a non-Markdown file', () => {
		const selected = selectFolderNotePaths(VAULT, 'Aide Test');
		expect(selected).not.toContain('Aide Test/diagram.png');
		expect(selected.every(isMarkdownPath)).toBe(true);
	});

	it('excludes sibling folders with a shared prefix', () => {
		expect(selectFolderNotePaths(VAULT, 'Aide Test')).not.toContain(
			'Aide Testing/Unrelated.md',
		);
	});

	it('reaches into a nested folder on its own', () => {
		expect(selectFolderNotePaths(VAULT, 'Aide Test/Searching')).toEqual([
			'Aide Test/Searching/Linear Search.md',
			'Aide Test/Searching/Search Notes.md',
		]);
	});

	it('orders deterministically so truncation is repeatable', () => {
		const shuffled = [...VAULT].reverse();
		expect(selectFolderNotePaths(shuffled, 'Aide Test')).toEqual(
			selectFolderNotePaths(VAULT, 'Aide Test'),
		);
	});

	it('returns nothing for a folder with no notes', () => {
		expect(selectFolderNotePaths(VAULT, 'Empty')).toEqual([]);
	});
});

describe('labels', () => {
	it('names a folder by its last segment', () => {
		expect(folderDisplayName('Aide Test/Searching')).toBe('Searching');
		expect(folderDisplayName('Top')).toBe('Top');
		expect(folderDisplayName('')).toBe('Vault root');
	});

	it('pluralises note counts', () => {
		expect(describeNoteCount(1)).toBe('1 note');
		expect(describeNoteCount(4)).toBe('4 notes');
		expect(describeNoteCount(0)).toBe('0 notes');
	});
});
