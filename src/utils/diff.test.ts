import { describe, expect, it } from 'vitest';
import { collapseDiff, diffLines, summarizeDiff } from './diff';

describe('diffLines', () => {
	it('marks unchanged lines as equal', () => {
		expect(diffLines('a\nb', 'a\nb')).toEqual([
			{ kind: 'equal', text: 'a' },
			{ kind: 'equal', text: 'b' },
		]);
	});

	it('detects an inserted line', () => {
		expect(diffLines('a\nc', 'a\nb\nc')).toEqual([
			{ kind: 'equal', text: 'a' },
			{ kind: 'add', text: 'b' },
			{ kind: 'equal', text: 'c' },
		]);
	});

	it('detects a removed line', () => {
		expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
			{ kind: 'equal', text: 'a' },
			{ kind: 'remove', text: 'b' },
			{ kind: 'equal', text: 'c' },
		]);
	});

	it('rebuilds the new text from equal and added lines', () => {
		const before = 'one\ntwo\nthree\nfour';
		const after = 'one\nTWO\nthree\nfour\nfive';
		const rebuilt = diffLines(before, after)
			.filter((line) => line.kind !== 'remove')
			.map((line) => line.text)
			.join('\n');
		expect(rebuilt).toBe(after);
	});
});

describe('summarizeDiff', () => {
	it('counts each kind of line', () => {
		expect(summarizeDiff(diffLines('a\nb', 'a\nc'))).toEqual({
			added: 1,
			removed: 1,
			unchanged: 1,
		});
	});
});

describe('collapseDiff', () => {
	it('replaces long unchanged runs with a marker', () => {
		const before = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
		const after = before.replace('line 15', 'changed');
		const collapsed = collapseDiff(diffLines(before, after), 2);

		expect(collapsed.length).toBeLessThan(30);
		expect(collapsed.some((line) => line.text.includes('unchanged lines'))).toBe(true);
		expect(collapsed.some((line) => line.kind === 'add' && line.text === 'changed')).toBe(
			true,
		);
	});
});
