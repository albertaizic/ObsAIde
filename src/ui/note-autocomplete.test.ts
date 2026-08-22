import { describe, expect, it, vi } from 'vitest';

// note-autocomplete.ts imports setIcon/setTooltip from 'obsidian' as values,
// but the installed obsidian package ships types only. Stub them so the real
// findTrigger/filterNoteCandidates exports can be loaded in tests.
vi.mock('obsidian', () => ({ setIcon: vi.fn(), setTooltip: vi.fn() }));

import { filterNoteCandidates, findTrigger } from './note-autocomplete';

describe('findTrigger', () => {
	it('triggers at the very start of the text', () => {
		expect(findTrigger('@notes')).toEqual({ position: 0, query: 'notes' });
	});

	it('triggers after whitespace', () => {
		expect(findTrigger('hey @todo')).toEqual({ position: 4, query: 'todo' });
	});

	it('ignores a mid-word @', () => {
		expect(findTrigger('foo@bar')).toBeNull();
	});

	it('computes the exact position and query', () => {
		expect(findTrigger('foo @ba')).toEqual({ position: 4, query: 'ba' });
	});

	it('keeps the latest trigger active', () => {
		expect(findTrigger('hello @one and @two')).toEqual({ position: 15, query: 'two' });
	});

	it('allows an empty query right after the @', () => {
		expect(findTrigger('hello @')).toEqual({ position: 6, query: '' });
	});

	it('allows a bare @ at the start', () => {
		expect(findTrigger('@')).toEqual({ position: 0, query: '' });
	});

	it('returns null when no trigger can be active', () => {
		expect(findTrigger('just words')).toBeNull();
		expect(findTrigger('')).toBeNull();
		// A second @ ends the first trigger without starting a new one.
		expect(findTrigger('@a@b')).toBeNull();
		// Text typed after the query deactivates the trigger.
		expect(findTrigger('hello @done already')).toBeNull();
	});
});

describe('filterNoteCandidates', () => {
	const notes = [
		{ displayPath: 'Projects/alpha plan.md', name: 'alpha plan' },
		{ displayPath: 'Areas/finance/budget.md', name: 'budget' },
		{ displayPath: 'Inbox/jot.md', name: 'jot' },
		{ displayPath: 'Archive/meeting-notes.md', name: 'meeting notes' },
	];

	it('returns every candidate for empty and whitespace-only queries', () => {
		expect(filterNoteCandidates(notes, '')).toEqual(notes);
		expect(filterNoteCandidates(notes, '   ')).toEqual(notes);
		// Always a fresh array, never the original reference.
		expect(filterNoteCandidates(notes, '')).not.toBe(notes);
	});

	it('matches paths case-insensitively', () => {
		expect(filterNoteCandidates(notes, 'PROJECTS')).toEqual([notes[0]]);
	});

	it('matches names case-insensitively', () => {
		expect(filterNoteCandidates(notes, 'JOT')).toEqual([notes[2]]);
	});

	it('matches substrings anywhere in path or name', () => {
		expect(filterNoteCandidates(notes, 'note')).toEqual([notes[3]]);
	});

	it('hits via displayPath even when the name lacks the query', () => {
		expect(filterNoteCandidates(notes, 'archive')).toEqual([notes[3]]);
	});

	it('trims surrounding whitespace before matching', () => {
		expect(filterNoteCandidates(notes, '  jot  ')).toEqual([notes[2]]);
	});

	it('preserves input order across combined hits', () => {
		const result = filterNoteCandidates(notes, 'a');
		expect(result.map((n) => n.name)).toEqual(['alpha plan', 'budget', 'meeting notes']);
	});

	it('returns an empty array when nothing matches', () => {
		expect(filterNoteCandidates(notes, 'zebra')).toEqual([]);
	});
});
