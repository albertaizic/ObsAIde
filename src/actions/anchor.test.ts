import { describe, expect, it } from 'vitest';
import {
	anchorHasSelection,
	blockAfterText,
	clampPosition,
	insertionPoint,
	locateSelection,
	positionAfterInsert,
	type EditorLike,
	type NoteEditAnchor,
	type Position,
} from './anchor';

/** A minimal stand-in for Obsidian's `Editor`, backed by a plain string. */
function createEditor(text: string): EditorLike & { setValue: (value: string) => void } {
	let value = text;
	const lines = (): string[] => value.split('\n');

	const posToOffset = (position: Position): number => {
		const all = lines();
		let offset = 0;
		for (let index = 0; index < position.line && index < all.length; index += 1) {
			offset += (all[index] ?? '').length + 1;
		}
		return offset + position.ch;
	};

	return {
		setValue: (next: string) => {
			value = next;
		},
		getValue: () => value,
		lastLine: () => lines().length - 1,
		getLine: (line: number) => lines()[line] ?? '',
		posToOffset,
		offsetToPos: (offset: number): Position => {
			const all = lines();
			let remaining = offset;
			for (let line = 0; line < all.length; line += 1) {
				const length = (all[line] ?? '').length;
				if (remaining <= length) return { line, ch: remaining };
				remaining -= length + 1;
			}
			const last = all.length - 1;
			return { line: last, ch: (all[last] ?? '').length };
		},
		getRange: (from: Position, to: Position) =>
			value.slice(posToOffset(from), posToOffset(to)),
	};
}

const DOCUMENT = '# Test\n\nBinary search halves the space.\nIts complexity is O(log n).';

describe('clampPosition', () => {
	it('leaves a valid position alone', () => {
		const editor = createEditor(DOCUMENT);
		expect(clampPosition(editor, { line: 2, ch: 5 })).toEqual({
			position: { line: 2, ch: 5 },
			clamped: false,
		});
	});

	it('pulls a position past the end back into the document', () => {
		const editor = createEditor(DOCUMENT);
		const result = clampPosition(editor, { line: 99, ch: 99 });
		expect(result.clamped).toBe(true);
		expect(result.position).toEqual({ line: 3, ch: 'Its complexity is O(log n).'.length });
	});

	it('clamps a column past the end of its line', () => {
		const editor = createEditor(DOCUMENT);
		expect(clampPosition(editor, { line: 0, ch: 50 })).toEqual({
			position: { line: 0, ch: 6 },
			clamped: true,
		});
	});

	it('rejects negative positions', () => {
		const editor = createEditor(DOCUMENT);
		expect(clampPosition(editor, { line: -3, ch: -8 }).position).toEqual({
			line: 0,
			ch: 0,
		});
	});
});

describe('locateSelection', () => {
	const selection = {
		from: { line: 3, ch: 0 },
		to: { line: 3, ch: 27 },
		text: 'Its complexity is O(log n).',
	};

	it('uses the captured range while it still holds the same text', () => {
		const editor = createEditor(DOCUMENT);
		expect(locateSelection(editor, selection)).toEqual({
			from: selection.from,
			to: selection.to,
			drifted: false,
		});
	});

	it('finds the text again after the note shifted', () => {
		const editor = createEditor(`# Added heading\n\n${DOCUMENT}`);
		const located = locateSelection(editor, selection);
		expect(located?.drifted).toBe(true);
		expect(editor.getRange(located!.from, located!.to)).toBe(selection.text);
	});

	it('still trusts the captured range even if the text now appears twice', () => {
		// The range itself is unambiguous, so a duplicate elsewhere is irrelevant.
		const editor = createEditor(`${DOCUMENT}\n${selection.text}`);
		expect(locateSelection(editor, selection)).toEqual({
			from: selection.from,
			to: selection.to,
			drifted: false,
		});
	});

	it('refuses to guess when the note moved and the text appears twice', () => {
		const editor = createEditor(`# Added\n\n${DOCUMENT}\n${selection.text}`);
		expect(editor.getRange(selection.from, selection.to)).not.toBe(selection.text);
		expect(locateSelection(editor, selection)).toBeNull();
	});

	it('refuses when the text is gone', () => {
		const editor = createEditor('# Test\n\nSomething else entirely.');
		expect(locateSelection(editor, selection)).toBeNull();
	});

	it('refuses an empty selection', () => {
		const editor = createEditor(DOCUMENT);
		expect(
			locateSelection(editor, { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text: '' }),
		).toBeNull();
	});
});

describe('insertionPoint', () => {
	const anchor: NoteEditAnchor = { path: 'Test.md', cursor: { line: 2, ch: 6 } };

	it('returns the captured caret when the note is unchanged', () => {
		const editor = createEditor(DOCUMENT);
		expect(insertionPoint(editor, anchor)).toEqual({
			position: { line: 2, ch: 6 },
			clamped: false,
		});
	});

	it('survives the note being cut down while the reply generated', () => {
		const editor = createEditor('# Test');
		const result = insertionPoint(editor, anchor);
		expect(result.clamped).toBe(true);
		expect(result.position).toEqual({ line: 0, ch: 6 });
	});
});

describe('positionAfterInsert', () => {
	it('lands at the end of the inserted text', () => {
		const editor = createEditor('abc');
		expect(positionAfterInsert(editor, { line: 0, ch: 0 }, 'xy')).toEqual({
			line: 0,
			ch: 2,
		});
	});

	it('accounts for newlines in the inserted text', () => {
		const editor = createEditor('one\ntwo\nthree');
		expect(positionAfterInsert(editor, { line: 0, ch: 3 }, '\nmid')).toEqual({
			line: 1,
			ch: 3,
		});
	});
});

describe('blockAfterText', () => {
	it('separates the insertion from what came before', () => {
		const editor = createEditor('paragraph');
		expect(blockAfterText(editor, { line: 0, ch: 9 }, 'next')).toBe('\n\nnext');
	});

	it('does not add a gap at the very start of an empty line', () => {
		const editor = createEditor('one\n\ntwo');
		expect(blockAfterText(editor, { line: 1, ch: 0 }, 'next')).toBe('next');
	});
});

describe('anchorHasSelection', () => {
	it('is true only for an anchor carrying selected text', () => {
		expect(anchorHasSelection(undefined)).toBe(false);
		expect(anchorHasSelection({ path: 'a.md', cursor: { line: 0, ch: 0 } })).toBe(false);
		expect(
			anchorHasSelection({
				path: 'a.md',
				cursor: { line: 0, ch: 0 },
				selection: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, text: 'a' },
			}),
		).toBe(true);
	});
});
