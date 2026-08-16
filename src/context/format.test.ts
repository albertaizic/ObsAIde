import { describe, expect, it } from 'vitest';
import { applyContextLimits, composeUserContent, formatContextBlock } from './format';
import type { ResolvedAttachment } from './types';

function part(overrides: Partial<ResolvedAttachment> = {}): ResolvedAttachment {
	return {
		attachment: { id: 'a', kind: 'note', path: 'Notes/One.md', title: 'One' },
		content: 'body',
		truncated: false,
		...overrides,
	};
}

describe('formatContextBlock', () => {
	it('returns nothing when there is no context', () => {
		expect(formatContextBlock([])).toBe('');
	});

	it('tags each attachment with its origin', () => {
		const block = formatContextBlock([
			part(),
			part({
				attachment: {
					id: 'b',
					kind: 'selection',
					path: 'Notes/Two.md',
					title: 'Selection',
					lines: { from: 3, to: 9 },
				},
				content: 'chosen text',
			}),
		]);

		expect(block).toContain('<attachment type="note" note="Notes/One.md">');
		expect(block).toContain('<attachment type="selection" note="Notes/Two.md" lines="3-9">');
		expect(block).toContain('chosen text');
	});

	it('marks truncated content', () => {
		expect(formatContextBlock([part({ truncated: true })])).toContain('truncated by ObsAIde');
	});

	it('says so when a note disappeared', () => {
		const block = formatContextBlock([part({ missing: true, content: '' })]);
		expect(block).toContain('no longer available');
	});
});

describe('applyContextLimits', () => {
	it('trims each note to the per-note cap', () => {
		const [trimmed] = applyContextLimits([part({ content: 'x'.repeat(100) })], {
			maxCharsPerNote: 40,
			maxContextChars: 1000,
		});
		expect(trimmed?.content.length).toBeLessThanOrEqual(40);
		expect(trimmed?.truncated).toBe(true);
	});

	it('spends the request budget on the earliest attachments', () => {
		const parts = applyContextLimits(
			[part({ content: 'a'.repeat(60) }), part({ content: 'b'.repeat(60) })],
			{ maxCharsPerNote: 1000, maxContextChars: 60 },
		);
		expect(parts[0]?.content.length).toBe(60);
		expect(parts[1]?.content.length).toBe(0);
		expect(parts[1]?.truncated).toBe(true);
	});

	it('leaves missing notes alone', () => {
		const [trimmed] = applyContextLimits([part({ missing: true, content: '' })], {
			maxCharsPerNote: 10,
			maxContextChars: 10,
		});
		expect(trimmed?.missing).toBe(true);
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
