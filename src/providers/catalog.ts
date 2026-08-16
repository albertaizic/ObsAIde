import type { ProviderId } from './types';

/**
 * Static, user-facing description of each provider.
 *
 * `fallbackModels` are only a starting point for the model picker: every
 * provider here exposes a listing endpoint, and a custom model ID can always be
 * typed by hand. Keeping the seeds short avoids shipping a list that rots.
 */
export interface ProviderDescriptor {
	id: ProviderId;
	label: string;
	/** One line shown in settings under the provider heading. */
	summary: string;
	defaultBaseUrl: string;
	/** Whether the base URL is meant to be edited by the user. */
	baseUrlEditable: boolean;
	requiresApiKey: boolean;
	apiKeyUrl?: string;
	docsUrl?: string;
	fallbackModels: string[];
	defaultModel: string;
}

const DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
	openrouter: {
		id: 'openrouter',
		label: 'OpenRouter',
		summary: 'One key, hundreds of models from many vendors.',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		baseUrlEditable: false,
		requiresApiKey: true,
		apiKeyUrl: 'https://openrouter.ai/keys',
		docsUrl: 'https://openrouter.ai/docs',
		fallbackModels: [
			'openai/gpt-5.1',
			'anthropic/claude-sonnet-4.5',
			'google/gemini-2.5-flash',
		],
		defaultModel: 'openai/gpt-5.1',
	},
	openai: {
		id: 'openai',
		label: 'OpenAI',
		summary: 'GPT models through the Chat Completions API.',
		defaultBaseUrl: 'https://api.openai.com/v1',
		baseUrlEditable: true,
		requiresApiKey: true,
		apiKeyUrl: 'https://platform.openai.com/api-keys',
		docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
		fallbackModels: ['gpt-5.1', 'gpt-5-mini', 'gpt-4.1-mini'],
		defaultModel: 'gpt-5.1',
	},
	anthropic: {
		id: 'anthropic',
		label: 'Anthropic',
		summary: 'Claude models through the Messages API.',
		defaultBaseUrl: 'https://api.anthropic.com',
		baseUrlEditable: true,
		requiresApiKey: true,
		apiKeyUrl: 'https://console.anthropic.com/settings/keys',
		docsUrl: 'https://docs.claude.com/en/api/messages',
		fallbackModels: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
		defaultModel: 'claude-sonnet-4-5',
	},
	gemini: {
		id: 'gemini',
		label: 'Google Gemini',
		summary: 'Gemini models through the Generative Language API.',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com',
		baseUrlEditable: true,
		requiresApiKey: true,
		apiKeyUrl: 'https://aistudio.google.com/apikey',
		docsUrl: 'https://ai.google.dev/api/generate-content',
		fallbackModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
		defaultModel: 'gemini-2.5-flash',
	},
	groq: {
		id: 'groq',
		label: 'Groq',
		summary: 'Open models served at very low latency.',
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		baseUrlEditable: false,
		requiresApiKey: true,
		apiKeyUrl: 'https://console.groq.com/keys',
		docsUrl: 'https://console.groq.com/docs/api-reference',
		fallbackModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
		defaultModel: 'llama-3.3-70b-versatile',
	},
	mistral: {
		id: 'mistral',
		label: 'Mistral',
		summary: 'Mistral models through La Plateforme.',
		defaultBaseUrl: 'https://api.mistral.ai/v1',
		baseUrlEditable: false,
		requiresApiKey: true,
		apiKeyUrl: 'https://console.mistral.ai/api-keys',
		docsUrl: 'https://docs.mistral.ai/api/',
		fallbackModels: ['mistral-large-latest', 'mistral-small-latest'],
		defaultModel: 'mistral-large-latest',
	},
	custom: {
		id: 'custom',
		label: 'Custom (OpenAI-compatible)',
		summary:
			'Any endpoint that speaks the OpenAI Chat Completions API, including local servers.',
		defaultBaseUrl: '',
		baseUrlEditable: true,
		requiresApiKey: false,
		fallbackModels: [],
		defaultModel: '',
	},
};

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
	return DESCRIPTORS[id];
}

export function listProviderDescriptors(): ProviderDescriptor[] {
	return Object.values(DESCRIPTORS);
}
