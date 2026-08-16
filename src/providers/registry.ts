import { AideError } from './errors';
import { createAnthropicAdapter } from './anthropic';
import { createGeminiAdapter } from './gemini';
import { createOpenAiCompatibleAdapter } from './openai-compatible';
import { parseOpenRouterModels } from './openrouter';
import { getProviderDescriptor } from './catalog';
import {
	findConfigurationIssue,
	providerLabel,
	resolveBaseUrl,
	type ObsAideSettings,
} from '../settings/types';
import type { ProviderAdapter, ProviderId } from './types';

/**
 * OpenAI's reasoning-model families reject `temperature` outright, so it is
 * omitted for them rather than sent and silently ignored.
 */
function openAiSupportsTemperature(model: string): boolean {
	return !/^(o\d|gpt-5)/i.test(model);
}

/**
 * Build the adapter for a provider using the user's current configuration.
 * Throws an {@link AideError} rather than returning a half-configured adapter.
 */
export function createAdapter(
	settings: ObsAideSettings,
	id: ProviderId,
): ProviderAdapter {
	const issue = findConfigurationIssue(settings, id);
	if (issue === 'missing-api-key') {
		throw new AideError(
			'missing-api-key',
			`Add an API key for ${providerLabel(settings, id)} in ObsAIde settings.`,
		);
	}
	if (issue === 'missing-base-url') {
		throw new AideError(
			'not-configured',
			`Set a base URL for ${providerLabel(settings, id)} in ObsAIde settings.`,
		);
	}

	const connection = {
		apiKey: settings.providers[id].apiKey,
		baseUrl: resolveBaseUrl(settings, id),
		label: providerLabel(settings, id),
	};

	switch (id) {
		case 'anthropic':
			return createAnthropicAdapter(connection);
		case 'gemini':
			return createGeminiAdapter(connection);
		case 'openai':
			return createOpenAiCompatibleAdapter({
				id,
				label: getProviderDescriptor(id).label,
				baseUrl: connection.baseUrl,
				apiKey: connection.apiKey,
				maxTokensField: 'max_completion_tokens',
				supportsTemperature: openAiSupportsTemperature,
			});
		case 'openrouter':
			return createOpenAiCompatibleAdapter({
				id,
				label: getProviderDescriptor(id).label,
				baseUrl: connection.baseUrl,
				apiKey: connection.apiKey,
				parseModels: parseOpenRouterModels,
			});
		case 'groq':
		case 'mistral':
			return createOpenAiCompatibleAdapter({
				id,
				label: getProviderDescriptor(id).label,
				baseUrl: connection.baseUrl,
				apiKey: connection.apiKey,
			});
		case 'custom':
			return createOpenAiCompatibleAdapter({
				id,
				label: connection.label ?? 'Custom',
				baseUrl: connection.baseUrl,
				apiKey: connection.apiKey,
			});
	}
}
