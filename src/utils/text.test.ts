import { describe, expect, it } from 'vitest';
import {
	estimateTokens,
	formatApproxTokens,
	sanitizeNoteName,
	stripCodeFence,
	summarize,
	truncateText,
	uniqueNotePath,
} from './text';

describe('truncateText', () => {
	it('leaves text alone when it fits, exactly fits, or the limit disables cutting', () => {
		expect(truncateText('hello', 10)).toEqual({ text: 'hello', truncated: false });
		// Equal length counts as fitting; zero really means "nothing fits".
		expect(truncateText('hello', 5)).toEqual({ text: 'hello', truncated: false });
		expect(truncateText('hello', -1)).toEqual({ text: 'hello', truncated: false });
	});

	it('cuts at the character limit when there is no line break', () => {
		expect(truncateText('hello world, this is long', 10)).toEqual({
			text: 'hello worl',
			truncated: true,
		});
	});

	it('cuts at a late line boundary rather than mid-line', () => {
		expect(truncateText('Title\nBody line one\nmore body content here', 30)).toEqual({
			text: 'Title\nBody line one',
			truncated: true,
		});
	});

	it('ignores early line breaks and trims the tail of the cut', () => {
		expect(truncateText('ab\nrest of the line goes on and on', 20)).toEqual({
			text: 'ab\nrest of the line',
			truncated: true,
		});
	});

	it('produces an empty truncated result for a zero limit', () => {
		expect(truncateText('anything', 0)).toEqual({ text: '', truncated: true });
	});
});

describe('summarize', () => {
	it('flattens runs of whitespace into single spaces', () => {
		expect(summarize('Line one\n\tindented   spaced')).toBe('Line one indented spaced');
	});

	it('returns flattened text untouched when it fits the limit', () => {
		expect(summarize('x'.repeat(60))).toBe('x'.repeat(60));
	});

	it('ellipsizes past the limit, keeping limit - 1 characters plus the ellipsis', () => {
		expect(summarize('x'.repeat(61))).toBe(`${'x'.repeat(59)}…`);
		expect(summarize('hello world', 8)).toBe('hello w…');
	});

	it('trims dangling whitespace before appending the ellipsis', () => {
		expect(summarize('aaaa bb', 6)).toBe('aaaa…');
	});
});

describe('token estimates', () => {
	it('estimates a token per four characters, rounding up', () => {
		expect(estimateTokens('')).toBe(0);
		expect(estimateTokens('abcd')).toBe(1);
		expect(estimateTokens('abcde')).toBe(2);
		expect(estimateTokens('a'.repeat(400))).toBe(100);
	});

	it('reports small counts as plain token totals', () => {
		expect(formatApproxTokens('')).toBe('~0 tokens');
		expect(formatApproxTokens('hello')).toBe('~2 tokens');
	});

	it('switches to k notation at 1000 tokens', () => {
		expect(formatApproxTokens('a'.repeat(3996))).toBe('~999 tokens');
		expect(formatApproxTokens('a'.repeat(4000))).toBe('~1.0k tokens');
		expect(formatApproxTokens('a'.repeat(80_000))).toBe('~20.0k tokens');
	});
});

describe('sanitizeNoteName', () => {
	it('replaces every forbidden character with a dash', () => {
		expect(sanitizeNoteName('<>:"/\\|?*')).toBe('---------');
		expect(sanitizeNoteName('Chapter 3: What/Why?')).toBe('Chapter 3- What-Why-');
	});

	it('leaves clean names untouched', () => {
		expect(sanitizeNoteName('Note (v2) - draft_final 2026')).toBe(
			'Note (v2) - draft_final 2026',
		);
	});
});

describe('stripCodeFence', () => {
	it('returns plain text trimmed, with no fence changes', () => {
		expect(stripCodeFence('  just words  ')).toBe('just words');
		expect(stripCodeFence('line one\nline two')).toBe('line one\nline two');
	});

	it('unwraps a json fence, keeping the newline before the closing fence', () => {
		expect(stripCodeFence('```json\n{"ok":true}\n```')).toBe('{"ok":true}\n');
	});

	it('discards the opening fence together with its language tag', () => {
		expect(stripCodeFence('```ts\nconst x = 1;\n```')).toBe('const x = 1;\n');
	});

	it('strips the opening fence even when the closing fence never arrives', () => {
		expect(stripCodeFence('```json\n{"a":1}')).toBe('{"a":1}');
	});

	it('leaves a fence with no newline behind it untouched', () => {
		expect(stripCodeFence('```json')).toBe('```json');
		expect(stripCodeFence('```')).toBe('```');
	});

	it('tolerates surrounding whitespace around a well-formed fence', () => {
		expect(stripCodeFence('\n```json\n{"a":1}\n```\n')).toBe('{"a":1}\n');
	});
});

describe('uniqueNotePath', () => {
	it('returns the base path when it is free, consulting exists once', () => {
		let calls = 0;
		const path = uniqueNotePath('Notes', 'Summary', () => {
			calls++;
			return false;
		});
		expect(path).toBe('Notes/Summary.md');
		expect(calls).toBe(1);
	});

	it("suffixes ' 1' after the first collision", () => {
		const existing = new Set<string>(['Notes/Idea.md']);
		expect(uniqueNotePath('Notes', 'Idea', (p) => existing.has(p))).toBe('Notes/Idea 1.md');
	});

	it('keeps counting until it finds a free slot, independently of call order', () => {
		const existing = new Set<string>([
			'Notes/Idea.md',
			'Notes/Idea 1.md',
			'Notes/Idea 2.md',
		]);
		const exists = (p: string) => existing.has(p);
		expect(uniqueNotePath('Notes', 'Idea', exists)).toBe('Notes/Idea 3.md');
		// Pure predicate, unchanged store: asking again gives the same answer.
		expect(uniqueNotePath('Notes', 'Idea', exists)).toBe('Notes/Idea 3.md');
		expect(existing.size).toBe(3);
	});

	it('works with nested folder paths', () => {
		const existing = new Set<string>(['Projects/Arc/Plan.md']);
		expect(uniqueNotePath('Projects/Arc', 'Plan', (p) => existing.has(p))).toBe(
			'Projects/Arc/Plan 1.md',
		);
	});
});
