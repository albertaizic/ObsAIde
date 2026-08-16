import { describe, expect, it } from 'vitest';
import { maskSecret, redactSecrets } from './secrets';

describe('redactSecrets', () => {
	it('removes every occurrence of a key', () => {
		const key = 'sk-abcdefghijklmnop';
		expect(redactSecrets(`${key} failed for ${key}`, [key])).toBe(
			'[redacted] failed for [redacted]',
		);
	});

	it('ignores empty and implausibly short values', () => {
		expect(redactSecrets('a short a', ['', 'a'])).toBe('a short a');
	});

	it('leaves unrelated text alone', () => {
		expect(redactSecrets('all fine', ['sk-abcdefghijkl'])).toBe('all fine');
	});
});

describe('maskSecret', () => {
	it('shows only the ends of a key', () => {
		expect(maskSecret('sk-or-v1-1234567890abcd')).toBe('sk-o…abcd');
	});

	it('hides short values entirely', () => {
		expect(maskSecret('short')).toBe('••••');
		expect(maskSecret('')).toBe('');
	});
});
