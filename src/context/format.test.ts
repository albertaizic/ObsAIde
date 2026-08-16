import { describe, expect, it } from 'vitest';
import {
	applyContextLimits,
	composeUserContent,
	describeContextTrimming,
	formatContextBlock,
	summarizeContext,
} from './format';
import type { ResolvedAttachment } from './types';

function note(overrides: Partial<ResolvedAttachment> = {}): ResolvedAttachment {
	return {
		attachmentId: 'a',
		kind: 'note',
		role: 'primary',
		path: 'Notes/One.md',
		title: 'One',
		content: 'body',
		truncated: false,
		...overrides,
	};
}

describe('formatContextBlock', () => {
	it('returns nothing when there is no context', () => {
		expect(formatContextBlock([])).toBe('');
	});

	it('tags each attachment with its origin and role', () => {
		const block = formatContextBlock([
			note({
				kind: 'selection',
				path: 'Notes/Two.md',
				title: 'Selection',
				lines: { from: 3, to: 9 },
				content: 'chosen text',
			}),
			note({ role: 'supporting' }),
		]);

		expect(block).toContain('<attachment type="selection" role="primary" path="Notes/Two.md" lines="3-9">');
		expect(block).toContain('<attachment type="note" role="supporting" path="Notes/One.md">');
		expect(block).toContain('chosen text');
	});

	it('explains primary versus supporting when both are present', () => {
		const block = formatContextBlock([
			note({ kind: 'selection', role: 'primary', content: 'the sentence' }),
			note({ role: 'supporting' }),
		]);
		expect(block).toContain('role="primary" is what the user is asking about');
		expect(block).toContain('role="supporting" is background');
		expect(block).toContain('do not summarise');
	});

	it('uses the plain preamble when everything is primary', () => {
		const block = formatContextBlock([note(), note({ path: 'Notes/Two.md' })]);
		expect(block).toContain('Treat them as the source of truth');
		expect(block).not.toContain('role="supporting" is background');
	});

	it('uses the plain preamble when there is nothing primary to contrast with', () => {
		const block = formatContextBlock([note({ role: 'supporting' })]);
		expect(block).toContain('Treat them as the source of truth');
		expect(block).not.toContain('role="primary" is what the user is asking about');
	});

	it('records which folder a note arrived from', () => {
		const block = formatContextBlock([
			note({ path: 'CSE/Week 1/Searching.md', folderPath: 'CSE' }),
		]);
		expect(block).toContain('path="CSE/Week 1/Searching.md" folder="CSE"');
	});

	it('marks truncated content', () => {
		expect(formatContextBlock([note({ truncated: true })])).toContain(
			'truncated by ObsAIde',
		);
	});

	it('says so when a note disappeared', () => {
		expect(formatContextBlock([note({ missing: true, content: '' })])).toContain(
			'no longer available',
		);
	});

	it('names the notes it had to leave out', () => {
		const block = formatContextBlock([
			note(),
			note({ path: 'CSE/Dropped.md', omitted: true, content: '' }),
		]);
		expect(block).toContain('<attachment-omitted count="1">');
		expect(block).toContain('CSE/Dropped.md');
		expect(block).toContain('context budget was reached');
		// The omitted note must not be rendered as if it had been sent.
		expect(block).not.toContain('<attachment type="note" role="primary" path="CSE/Dropped.md">');
	});
});

describe('applyContextLimits', () => {
	it('trims each note to the per-note cap', () => {
		const [trimmed] = applyContextLimits([note({ content: 'x'.repeat(100) })], {
			maxCharsPerNote: 40,
			maxContextChars: 1000,
		});
		expect(trimmed?.content.length).toBeLessThanOrEqual(40);
		expect(trimmed?.truncated).toBe(true);
	});

	it('spends the request budget on the earliest attachments', () => {
		const parts = applyContextLimits(
			[note({ content: 'a'.repeat(60) }), note({ content: 'b'.repeat(60) })],
			{ maxCharsPerNote: 1000, maxContextChars: 60 },
		);
		expect(parts[0]?.content.length).toBe(60);
		expect(parts[1]?.omitted).toBe(true);
		expect(parts[1]?.content).toBe('');
	});

	it('stops a large folder from bypassing the request budget', () => {
		const folderNotes = Array.from({ length: 20 }, (_, index) =>
			note({
				attachmentId: 'folder',
				path: `CSE/Note ${index}.md`,
				folderPath: 'CSE',
				content: 'z'.repeat(500),
			}),
		);
		const parts = applyContextLimits(folderNotes, {
			maxCharsPerNote: 500,
			maxContextChars: 1200,
		});

		const total = parts.reduce((sum, part) => sum + part.content.length, 0);
		expect(total).toBeLessThanOrEqual(1200);
		expect(parts.some((part) => part.omitted)).toBe(true);
		// Ordering is preserved, so the same folder always truncates the same way.
		expect(parts[0]?.path).toBe('CSE/Note 0.md');
		expect(parts.at(-1)?.omitted).toBe(true);
	});

	it('leaves missing notes alone', () => {
		const [trimmed] = applyContextLimits([note({ missing: true, content: '' })], {
			maxCharsPerNote: 10,
			maxContextChars: 10,
		});
		expect(trimmed?.missing).toBe(true);
		expect(trimmed?.omitted).toBeUndefined();
	});
});

describe('summarizeContext', () => {
	it('counts what was sent, trimmed and dropped', () => {
		expect(
			summarizeContext([
				note({ content: 'abcd' }),
				note({ content: 'ab', truncated: true }),
				note({ content: '', omitted: true }),
			]),
		).toEqual({ notes: 2, truncated: 1, omitted: 1, characters: 6 });
	});
});

describe('describeContextTrimming', () => {
	it('says nothing when everything fitted', () => {
		expect(
			describeContextTrimming({ notes: 2, truncated: 0, omitted: 0, characters: 10 }),
		).toBeUndefined();
	});

	it('reports shortened and dropped notes to the user', () => {
		expect(
			describeContextTrimming({ notes: 3, truncated: 1, omitted: 2, characters: 10 }),
		).toBe('1 note was shortened and 2 notes were left out to fit the context budget.');
	});

	it('reports truncation on its own', () => {
		expect(
			describeContextTrimming({ notes: 3, truncated: 2, omitted: 0, characters: 10 }),
		).toBe('2 notes were shortened to fit the context budget.');
	});
});

describe('composeUserContent', () => {
	it('puts the question after the context', () => {
		expect(composeUserContent('CONTEXT', 'Why?')).toBe('CONTEXT\n\nWhy?');
	});

	it('handles either side being empty', () => {
		expect(composeUserContent('', 'Why?')).toBe('Why?');
		expect(composeUserContent('CONTEXT', '   ')).toBe('CONTEXT');
	});
});
