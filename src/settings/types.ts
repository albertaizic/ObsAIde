import { getProviderDescriptor } from '../providers/catalog';
import { isProviderId, PROVIDER_IDS, type ProviderId } from '../providers/types';

/** Per-provider configuration. Stored locally in the plugin's `data.json`. */
export interface ProviderSettings {
	/** Whether the provider is offered in the chat provider picker. */
	enabled: boolean;
	apiKey: string;
	/** Empty string means "use the built-in default for this provider". */
	baseUrl: string;
	/** Last model chosen for this provider. */
	model: string;
}

/** Context mode for custom actions. */
export type CustomActionContextMode = 'smart' | 'selection' | 'section' | 'note';

/** Smart context scope selector options. */
export type ContextScope = 'none' | 'selection' | 'section' | 'note' | 'linked' | 'folder';

/** Output mode for custom actions. */
export type CustomActionOutputMode = 'answer' | 'note-ready' | 'rewrite';

/** A user-defined custom AI action. */
export interface CustomAction {
	/** Stable unique ID. */
	id: string;
	/** Display name. */
	name: string;
	/** Icon name (Obsidian icon). */
	icon: string;
	/** The instruction/prompt for the AI. */
	instruction: string;
	/** What context to include. */
	contextMode: CustomActionContextMode;
	/** How to handle the output. */
	outputMode: CustomActionOutputMode;
	/** Whether this action is enabled. */
	enabled: boolean;
}

export interface ObsAideSettings {
	schemaVersion: number;
	defaultProvider: ProviderId;
	providers: Record<ProviderId, ProviderSettings>;
	/** Display name for the custom OpenAI-compatible provider. */
	customProviderLabel: string;
	/** Appended to Aide's system prompt for every request. */
	customInstructions: string;
	temperature: number;
	maxOutputTokens: number;
	/** Stream responses when the provider and environment allow it. */
	streaming: boolean;
	/** Start new conversations in tutor mode. */
	tutorModeByDefault: boolean;
	/** Keep conversation history in the plugin folder between sessions. */
	persistConversations: boolean;
	/** Per-note cap when a note is attached as context. */
	maxCharsPerNote: number;
	/** Cap across all attachments in a single request. */
	maxContextChars: number;
	/** Response length preference. */
	responseLength: 'short' | 'normal' | 'detailed';
	/** User-defined custom actions. */
	customActions: CustomAction[];
	/** Default context scope for new conversations. */
	contextScope: ContextScope;
}

/**
 * Temperature is capped at 1.0 on purpose.
 *
 * Above that, most chat models degrade into incoherent output, and a global
 * slider is the wrong place to let someone do that by accident. Providers that
 * accept a wider range are clamped in `providers/capabilities.ts`.
 */
export const TEMPERATURE_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const MAX_OUTPUT_TOKENS_RANGE = { min: 256, max: 16_000 } as const;
export const CONTEXT_CHAR_RANGE = { min: 1_000, max: 200_000 } as const;

export const SCHEMA_VERSION = 3;

function defaultProviderSettings(id: ProviderId): ProviderSettings {
	const descriptor = getProviderDescriptor(id);
	return {
		enabled: true,
		apiKey: '',
		baseUrl: '',
		model: descriptor.defaultModel,
	};
}

export function createDefaultSettings(): ObsAideSettings {
	const providers = {} as Record<ProviderId, ProviderSettings>;
	for (const id of PROVIDER_IDS) {
		providers[id] = defaultProviderSettings(id);
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		defaultProvider: 'openrouter',
		providers,
		customProviderLabel: 'Custom',
		customInstructions: '',
		// Aimed at concise, factual help rather than creative writing.
		temperature: 0.3,
		maxOutputTokens: 4096,
		streaming: true,
		tutorModeByDefault: false,
		persistConversations: true,
		maxCharsPerNote: 16_000,
		maxContextChars: 48_000,
		responseLength: 'normal',
		customActions: [],
		contextScope: 'selection',
	};
}

function clamp(value: number, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function asString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

/**
 * Merge persisted data onto the defaults, dropping anything unusable.
 *
 * Settings files survive plugin upgrades and hand edits, so every field is
 * validated rather than trusted.
 */
export function normalizeSettings(raw: unknown): ObsAideSettings {
	const defaults = createDefaultSettings();
	if (typeof raw !== 'object' || raw === null) return defaults;
	const data = raw as Record<string, unknown>;

	const storedProviders =
		typeof data['providers'] === 'object' && data['providers'] !== null
			? (data['providers'] as Record<string, unknown>)
			: {};

	const providers = {} as Record<ProviderId, ProviderSettings>;
	for (const id of PROVIDER_IDS) {
		const fallback = defaults.providers[id];
		const stored = storedProviders[id];
		if (typeof stored !== 'object' || stored === null) {
			providers[id] = fallback;
			continue;
		}
		const entry = stored as Record<string, unknown>;
		providers[id] = {
			enabled: asBoolean(entry['enabled'], fallback.enabled),
			apiKey: asString(entry['apiKey'], fallback.apiKey).trim(),
			baseUrl: asString(entry['baseUrl'], fallback.baseUrl).trim(),
			model: asString(entry['model'], fallback.model).trim(),
		};
	}

	const defaultProvider = isProviderId(data['defaultProvider'])
		? data['defaultProvider']
		: defaults.defaultProvider;

	return {
		schemaVersion: SCHEMA_VERSION,
		defaultProvider,
		providers,
		customProviderLabel:
			asString(data['customProviderLabel'], defaults.customProviderLabel).trim() ||
			defaults.customProviderLabel,
		customInstructions: asString(data['customInstructions'], defaults.customInstructions),
		temperature: clamp(
			data['temperature'] as number,
			TEMPERATURE_RANGE.min,
			TEMPERATURE_RANGE.max,
			defaults.temperature,
		),
		maxOutputTokens: Math.round(
			clamp(
				data['maxOutputTokens'] as number,
				MAX_OUTPUT_TOKENS_RANGE.min,
				MAX_OUTPUT_TOKENS_RANGE.max,
				defaults.maxOutputTokens,
			),
		),
		streaming: asBoolean(data['streaming'], defaults.streaming),
		tutorModeByDefault: asBoolean(data['tutorModeByDefault'], defaults.tutorModeByDefault),
		persistConversations: asBoolean(
			data['persistConversations'],
			defaults.persistConversations,
		),
		maxCharsPerNote: Math.round(
			clamp(
				data['maxCharsPerNote'] as number,
				CONTEXT_CHAR_RANGE.min,
				CONTEXT_CHAR_RANGE.max,
				defaults.maxCharsPerNote,
			),
		),
		maxContextChars: Math.round(
			clamp(
				data['maxContextChars'] as number,
				CONTEXT_CHAR_RANGE.min,
				CONTEXT_CHAR_RANGE.max,
				defaults.maxContextChars,
			),
		),
		responseLength: (['short', 'normal', 'detailed'] as const).includes(
			data['responseLength'] as 'short' | 'normal' | 'detailed',
		)
			? (data['responseLength'] as 'short' | 'normal' | 'detailed')
			: defaults.responseLength,
		customActions: Array.isArray(data['customActions'])
			? data['customActions'].map((a: unknown) => {
				const obj = a as Record<string, unknown>;
				return {
					id: asString(obj['id'], ''),
					name: asString(obj['name'], ''),
					icon: asString(obj['icon'], 'zap'),
					instruction: asString(obj['instruction'], ''),
					contextMode: (['smart', 'selection', 'section', 'note'] as const).includes(
						obj['contextMode'] as CustomActionContextMode,
					)
						? (obj['contextMode'] as CustomActionContextMode)
						: 'smart',
					outputMode: (['answer', 'note-ready', 'rewrite'] as const).includes(
						obj['outputMode'] as CustomActionOutputMode,
					)
						? (obj['outputMode'] as CustomActionOutputMode)
						: 'answer',
					enabled: asBoolean(obj['enabled'], true),
				};
			})
			: defaults.customActions,
		contextScope: (['none', 'selection', 'section', 'note', 'linked', 'folder'] as const).includes(
			data['contextScope'] as ContextScope,
		)
			? (data['contextScope'] as ContextScope)
			: defaults.contextScope,
	};
}

/** Base URL actually used for a provider, honouring any user override. */
export function resolveBaseUrl(settings: ObsAideSettings, id: ProviderId): string {
	const override = settings.providers[id].baseUrl.trim();
	return (override || getProviderDescriptor(id).defaultBaseUrl).replace(/\/+$/, '');
}

/** Name shown in the UI; the custom provider can be renamed by the user. */
export function providerLabel(settings: ObsAideSettings, id: ProviderId): string {
	if (id === 'custom') return settings.customProviderLabel || 'Custom';
	return getProviderDescriptor(id).label;
}

export type ConfigurationIssue = 'missing-api-key' | 'missing-base-url' | 'missing-model' | null;

/** What, if anything, stops this provider from being usable right now. */
export function findConfigurationIssue(
	settings: ObsAideSettings,
	id: ProviderId,
): ConfigurationIssue {
	const descriptor = getProviderDescriptor(id);
	const provider = settings.providers[id];
	if (!resolveBaseUrl(settings, id)) return 'missing-base-url';
	if (descriptor.requiresApiKey && !provider.apiKey) return 'missing-api-key';
	if (!provider.model) return 'missing-model';
	return null;
}

export function isProviderConfigured(settings: ObsAideSettings, id: ProviderId): boolean {
	return findConfigurationIssue(settings, id) === null;
}

/**
 * Whether the settings on disk differ from what ObsAIde will now use.
 *
 * The caller writes the normalised settings back when this is true, so a value
 * that was legal under an older schema — a temperature of 2.0 from before the
 * cap — cannot keep being sent to providers after the UI has stopped offering
 * it.
 */
export function needsMigration(raw: unknown, normalized: ObsAideSettings): boolean {
	if (typeof raw !== 'object' || raw === null) return false;
	const data = raw as Record<string, unknown>;
	if (data['schemaVersion'] !== SCHEMA_VERSION) return true;
	return (
		data['temperature'] !== normalized.temperature ||
		data['maxOutputTokens'] !== normalized.maxOutputTokens ||
		data['responseLength'] !== normalized.responseLength ||
		!Array.isArray(data['customActions'])
	);
}

/** Every API key currently stored, used to scrub diagnostics. */
export function collectSecrets(settings: ObsAideSettings): string[] {
	return PROVIDER_IDS.map((id) => settings.providers[id].apiKey).filter(
		(key): key is string => key.length > 0,
	);
}
