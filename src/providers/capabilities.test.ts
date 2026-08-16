import { describe, expect, it } from 'vitest';
import { getTemperatureSupport, resolveTemperature, supportsTemperature } from './capabilities';

describe('temperature support', () => {
	it('omits the parameter for OpenAI reasoning families', () => {
		expect(supportsTemperature('openai', 'gpt-5.1')).toBe(false);
		expect(supportsTemperature('openai', 'gpt-5-mini')).toBe(false);
		expect(supportsTemperature('openai', 'o3')).toBe(false);
		expect(supportsTemperature('openai', 'o4-mini')).toBe(false);
	});

	it('keeps the parameter for models that accept it', () => {
		expect(supportsTemperature('openai', 'gpt-4.1')).toBe(true);
		expect(supportsTemperature('anthropic', 'claude-sonnet-4-5')).toBe(true);
		expect(supportsTemperature('gemini', 'gemini-2.5-flash')).toBe(true);
		expect(supportsTemperature('mistral', 'mistral-large-latest')).toBe(true);
	});

	it('sees through an OpenRouter vendor prefix', () => {
		expect(supportsTemperature('openrouter', 'openai/gpt-5.1')).toBe(false);
		expect(supportsTemperature('openrouter', 'openai/o3')).toBe(false);
		expect(supportsTemperature('openrouter', 'anthropic/claude-sonnet-4.5')).toBe(true);
	});

	it('applies the same rule to a custom gateway proxying OpenAI', () => {
		expect(supportsTemperature('custom', 'gpt-5.1')).toBe(false);
		expect(supportsTemperature('custom', 'llama-3.3-70b')).toBe(true);
	});

	it('records the documented ceiling per provider', () => {
		expect(getTemperatureSupport('anthropic', 'claude-sonnet-4-5').max).toBe(1);
		expect(getTemperatureSupport('mistral', 'mistral-large-latest').max).toBe(1);
		expect(getTemperatureSupport('gemini', 'gemini-2.5-flash').max).toBe(2);
	});
});

describe('resolveTemperature', () => {
	it('passes a normal value straight through', () => {
		expect(resolveTemperature('openai', 'gpt-4.1', 0.3)).toBe(0.3);
	});

	it('returns undefined for models that reject the parameter', () => {
		expect(resolveTemperature('openai', 'gpt-5.1', 0.9)).toBeUndefined();
		expect(resolveTemperature('openrouter', 'openai/o3', 0.9)).toBeUndefined();
	});

	it('clamps to the provider ceiling', () => {
		// Nothing in the UI can produce this any more, but a hand-edited
		// settings file still must not reach the provider out of range.
		expect(resolveTemperature('anthropic', 'claude-sonnet-4-5', 2)).toBe(1);
		expect(resolveTemperature('mistral', 'mistral-large-latest', 1.8)).toBe(1);
		expect(resolveTemperature('gemini', 'gemini-2.5-flash', 5)).toBe(2);
	});

	it('clamps negatives to zero', () => {
		expect(resolveTemperature('groq', 'llama-3.3-70b-versatile', -1)).toBe(0);
	});

	it('omits the parameter when nothing was requested', () => {
		expect(resolveTemperature('openai', 'gpt-4.1', undefined)).toBeUndefined();
		expect(resolveTemperature('openai', 'gpt-4.1', Number.NaN)).toBeUndefined();
	});
});
