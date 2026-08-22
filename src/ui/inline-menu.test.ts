import { describe, expect, it } from 'vitest';
import { isUnchangedSelection, type SelectionRange } from './inline-selection';

function range(fromLine: number, fromCh: number, toLine: number, toCh: number): SelectionRange {
	return {
		from: { line: fromLine, ch: fromCh },
		to: { line: toLine, ch: toCh },
	};
}

const shown = range(3, 7, 3, 20);

describe('isUnchangedSelection', () => {
	it('treats a first show (no previous selection) as changed', () => {
		expect(isUnchangedSelection(null, shown)).toBe(false);
	});

	it('leaves the menu in place when the selection is identical', () => {
		expect(isUnchangedSelection(shown, range(3, 7, 3, 20))).toBe(true);
	});

	it('re-renders when the anchor line moves by one', () => {
		expect(isUnchangedSelection(shown, range(4, 7, 3, 20))).toBe(false);
	});

	it('re-renders when the anchor column moves by one', () => {
		expect(isUnchangedSelection(shown, range(3, 8, 3, 20))).toBe(false);
	});

	it('re-renders when the head line moves by one', () => {
		expect(isUnchangedSelection(shown, range(3, 7, 4, 20))).toBe(false);
	});

	it('re-renders when the head column moves by one', () => {
		expect(isUnchangedSelection(shown, range(3, 7, 3, 21))).toBe(false);
	});

	it('re-renders when the anchors are swapped (selection dragged the other way)', () => {
		const reversed: SelectionRange = { from: shown.to, to: shown.from };
		expect(isUnchangedSelection(shown, reversed)).toBe(false);
	});

	it('is unchanged when the very same object comes back as current', () => {
		expect(isUnchangedSelection(shown, shown)).toBe(true);
	});
});
