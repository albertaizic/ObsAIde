import { describe, expect, it } from 'vitest';
import { AideError, buildErrorMessage, classifyHttpFailure, toAideError } from './errors';

const SECRET = 'sk-test-000111222333444555';

describe('classifyHttpFailure', () => {
	it('maps authentication statuses', () => {
		expect(classifyHttpFailure(401, 'Incorrect API key')).toBe('authentication');
		expect(classifyHttpFailure(403, 'Invalid api key')).toBe('authentication');
		expect(classifyHttpFailure(403, 'Region not supported')).toBe('permission');
	});

	it('separates rate limits from quota problems', () => {
		expect(classifyHttpFailure(429, 'Rate limit reached')).toBe('rate-limit');
		expect(classifyHttpFailure(429, 'You exceeded your current quota')).toBe('quota');
		expect(classifyHttpFailure(402, 'Insufficient credits')).toBe('quota');
	});

	it('detects unknown models', () => {
		expect(classifyHttpFailure(404, 'The model `x` does not exist')).toBe('invalid-model');
		expect(classifyHttpFailure(400, 'model not found')).toBe('invalid-model');
		expect(classifyHttpFailure(400, 'messages must not be empty')).toBe('invalid-request');
	});

	it('maps server and timeout statuses', () => {
		expect(classifyHttpFailure(500, undefined)).toBe('server');
		expect(classifyHttpFailure(503, undefined)).toBe('server');
		expect(classifyHttpFailure(504, undefined)).toBe('timeout');
	});
});

describe('buildErrorMessage', () => {
	it('appends the provider detail to the headline', () => {
		expect(buildErrorMessage('authentication', 'Incorrect API key')).toBe(
			'The provider rejected the API key. Incorrect API key',
		);
	});

	it('falls back to the headline alone', () => {
		expect(buildErrorMessage('network', undefined)).toBe('Could not reach the provider.');
	});
});

describe('toAideError', () => {
	it('passes AideError through untouched', () => {
		const original = new AideError('rate-limit', 'slow down');
		expect(toAideError(original)).toBe(original);
	});

	it('treats transport failures as network errors', () => {
		const error = toAideError(new TypeError('Failed to fetch'));
		expect(error.kind).toBe('network');
		expect(error.retryable).toBe(true);
	});

	it('never lets an API key reach the message', () => {
		const error = toAideError(new Error(`request failed for key ${SECRET}`), [SECRET]);
		expect(error.message).not.toContain(SECRET);
		expect(error.message).toContain('[redacted]');
	});

	it('recognises aborts', () => {
		const abort = new Error('aborted');
		abort.name = 'AbortError';
		expect(toAideError(abort).kind).toBe('aborted');
	});
});
