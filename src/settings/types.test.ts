import { describe, expect, it } from 'vitest';
import {
	collectSecrets,
	createDefaultSettings,
	findConfigurationIssue,
	isProviderConfigured,
	needsMigration,
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

	it('defaults contextScope to "none" for new conversations', () => {
		expect(createDefaultSettings().contextScope).toBe('none');
		expect(normalizeSettings({}).contextScope).toBe('none');
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
		expect(settings.temperature).toBe(1);
		expect(settings.maxOutputTokens).toBe(256);
		expect(settings.maxCharsPerNote).toBe(200_000);
	});

	it('migrates a temperature stored above the new maximum', () => {
		// The old schema allowed up to 2.0, which produced incoherent output.
		expect(normalizeSettings({ schemaVersion: 1, temperature: 2 }).temperature).toBe(1);
		expect(normalizeSettings({ schemaVersion: 1, temperature: 1.4 }).temperature).toBe(1);
	});

	it('defaults to a focused temperature', () => {
		expect(createDefaultSettings().temperature).toBe(0.3);
	});

	it('caps a stored output-token value at the new maximum', () => {
		expect(normalizeSettings({ maxOutputTokens: 32_000 }).maxOutputTokens).toBe(16_000);
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

describe('needsMigration', () => {
	it('is true when a clamped value differs from what was stored', () => {
		const raw = { schemaVersion: 1, temperature: 2 };
		expect(needsMigration(raw, normalizeSettings(raw))).toBe(true);
	});

	it('is true when the schema version is behind', () => {
		const raw = { schemaVersion: 1, temperature: 0.3, maxOutputTokens: 4096 };
		expect(needsMigration(raw, normalizeSettings(raw))).toBe(true);
	});

	it('is false for settings already in the current shape', () => {
		const settings = createDefaultSettings();
		expect(needsMigration({ ...settings }, normalizeSettings({ ...settings }))).toBe(false);
	});

	it('is false when there is nothing stored yet', () => {
		expect(needsMigration(undefined, createDefaultSettings())).toBe(false);
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
