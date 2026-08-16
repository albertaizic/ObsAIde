import { describe, expect, it } from 'vitest';
import {
	collectSecrets,
	createDefaultSettings,
	findConfigurationIssue,
	isProviderConfigured,
	normalizeSettings,
	providerLabel,
	resolveBaseUrl,
} from './types';
import { PROVIDER_IDS } from '../providers/types';

describe('normalizeSettings', () => {
	it('falls back to defaults for junk input', () => {
		expect(normalizeSettings(null)).toEqual(createDefaultSettings());
		expect(normalizeSettings('nope')).toEqual(createDefaultSettings());
	});

	it('always produces an entry for every provider', () => {
		const settings = normalizeSettings({ providers: { openai: { apiKey: 'k' } } });
		for (const id of PROVIDER_IDS) {
			expect(settings.providers[id]).toBeDefined();
		}
		expect(settings.providers.openai.apiKey).toBe('k');
	});

	it('clamps numeric settings into range', () => {
		const settings = normalizeSettings({
			temperature: 99,
			maxOutputTokens: 1,
			maxCharsPerNote: 10 ** 9,
		});
		expect(settings.temperature).toBe(2);
		expect(settings.maxOutputTokens).toBe(256);
		expect(settings.maxCharsPerNote).toBe(200_000);
	});

	it('rejects an unknown default provider', () => {
		expect(normalizeSettings({ defaultProvider: 'skynet' }).defaultProvider).toBe(
			'openrouter',
		);
		expect(normalizeSettings({ defaultProvider: 'groq' }).defaultProvider).toBe('groq');
	});

	it('trims whitespace out of keys, URLs and model IDs', () => {
		const settings = normalizeSettings({
			providers: { groq: { apiKey: '  k  ', baseUrl: ' https://x ', model: ' m ' } },
		});
		expect(settings.providers.groq).toMatchObject({
			apiKey: 'k',
			baseUrl: 'https://x',
			model: 'm',
		});
	});
});

describe('provider configuration', () => {
	it('reports what is missing', () => {
		const settings = createDefaultSettings();
		expect(findConfigurationIssue(settings, 'openai')).toBe('missing-api-key');

		settings.providers.openai.apiKey = 'sk-1';
		expect(findConfigurationIssue(settings, 'openai')).toBeNull();

		settings.providers.openai.model = '';
		expect(findConfigurationIssue(settings, 'openai')).toBe('missing-model');
	});

	it('requires a base URL for the custom provider', () => {
		const settings = createDefaultSettings();
		expect(findConfigurationIssue(settings, 'custom')).toBe('missing-base-url');

		settings.providers.custom.baseUrl = 'http://localhost:11434/v1';
		settings.providers.custom.model = 'llama';
		expect(isProviderConfigured(settings, 'custom')).toBe(true);
	});

	it('prefers the user base URL over the default', () => {
		const settings = createDefaultSettings();
		expect(resolveBaseUrl(settings, 'openai')).toBe('https://api.openai.com/v1');
		settings.providers.openai.baseUrl = 'https://proxy.example/v1/';
		expect(resolveBaseUrl(settings, 'openai')).toBe('https://proxy.example/v1');
	});

	it('uses the custom display name', () => {
		const settings = createDefaultSettings();
		settings.customProviderLabel = 'Home server';
		expect(providerLabel(settings, 'custom')).toBe('Home server');
		expect(providerLabel(settings, 'groq')).toBe('Groq');
	});
});

describe('collectSecrets', () => {
	it('gathers every configured key and nothing else', () => {
		const settings = createDefaultSettings();
		settings.providers.openai.apiKey = 'sk-one';
		settings.providers.groq.apiKey = 'gsk-two';
		expect(collectSecrets(settings).sort()).toEqual(['gsk-two', 'sk-one']);
	});
});
