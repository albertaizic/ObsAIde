import {
	collectSecrets,
	findConfigurationIssue,
	providerLabel,
	type ObsAideSettings,
} from '../settings/types';
import { resolveTemperature } from './capabilities';
import { getProviderDescriptor } from './catalog';
import { listModels, runChat, type RunChatOptions } from './client';
import { AideError } from './errors';
import type { HttpClient } from './http';
import { createAdapter } from './registry';
import type { ChatMessage, ChatResult, ModelInfo, ProviderId } from './types';

export interface CompletionOptions {
	providerId: ProviderId;
	model: string;
	system?: string;
	messages: ChatMessage[];
	signal?: AbortSignal;
	onText?: (delta: string) => void;
	/** Override the configured output cap, used by short internal requests. */
	maxOutputTokens?: number;
}

interface ModelCacheEntry {
	models: ModelInfo[];
	fetchedAt: number;
	/** Fingerprint of the connection settings the list was fetched with. */
	fingerprint: string;
}

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Settings-aware facade over the provider layer.
 *
 * The chat view, note actions and the settings tab all talk to this class, so
 * none of them has to know how a provider is configured or called.
 */
export class ProviderService {
	private readonly modelCache = new Map<ProviderId, ModelCacheEntry>();

	constructor(
		private readonly getSettings: () => ObsAideSettings,
		private readonly http: HttpClient,
	) {}

	/** Human readable name, honouring a renamed custom provider. */
	label(providerId: ProviderId): string {
		return providerLabel(this.getSettings(), providerId);
	}

	/**
	 * Providers offered in the sidebar picker, in catalogue order. The current
	 * default is always included, so disabling everything cannot strand the user
	 * on a provider they can no longer switch away from.
	 */
	availableProviders(): ProviderId[] {
		const settings = this.getSettings();
		return (Object.keys(settings.providers) as ProviderId[]).filter(
			(id) => settings.providers[id].enabled || id === settings.defaultProvider,
		);
	}

	/** Throws a precise {@link AideError} when a provider cannot be used. */
	assertUsable(providerId: ProviderId): void {
		const settings = this.getSettings();
		const issue = findConfigurationIssue(settings, providerId);
		if (!issue) return;
		const name = providerLabel(settings, providerId);
		if (issue === 'missing-api-key') {
			throw new AideError('missing-api-key', `Add an API key for ${name} in ObsAIde settings.`);
		}
		if (issue === 'missing-base-url') {
			throw new AideError('not-configured', `Set a base URL for ${name} in ObsAIde settings.`);
		}
		throw new AideError('not-configured', `Choose a model for ${name} before sending.`);
	}

	async complete(options: CompletionOptions): Promise<ChatResult> {
		const settings = this.getSettings();
		this.assertUsable(options.providerId);

		const adapter = createAdapter(settings, options.providerId);
		const runOptions: RunChatOptions = {
			signal: options.signal,
			onText: options.onText,
			stream: settings.streaming,
			secrets: collectSecrets(settings),
		};

		return runChat(
			adapter,
			{
				model: options.model,
				messages: options.messages,
				system: options.system,
				// Clamped to what this provider documents, and omitted entirely
				// for models that reject the parameter.
				temperature: resolveTemperature(
					options.providerId,
					options.model,
					settings.temperature,
				),
				maxOutputTokens: options.maxOutputTokens ?? settings.maxOutputTokens,
			},
			this.http,
			runOptions,
		);
	}

	/**
	 * Models offered by a provider. Discovery results are cached briefly and
	 * fall back to the catalogue seeds so the picker is never empty.
	 */
	async listModels(
		providerId: ProviderId,
		options: { refresh?: boolean; signal?: AbortSignal } = {},
	): Promise<ModelInfo[]> {
		const settings = this.getSettings();
		const descriptor = getProviderDescriptor(providerId);
		const fingerprint = this.fingerprint(providerId);

		const cached = this.modelCache.get(providerId);
		if (
			!options.refresh &&
			cached &&
			cached.fingerprint === fingerprint &&
			Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS
		) {
			return cached.models;
		}

		try {
			this.assertUsable(providerId);
			const adapter = createAdapter(settings, providerId);
			const models = await listModels(adapter, this.http, {
				signal: options.signal,
				secrets: collectSecrets(settings),
			});
			if (models.length > 0) {
				this.modelCache.set(providerId, { models, fetchedAt: Date.now(), fingerprint });
				return models;
			}
		} catch (error) {
			// Discovery is a convenience: a failure here must never block the
			// picker, so fall through to the seeded list.
			if (error instanceof AideError && error.kind === 'aborted') throw error;
		}

		return descriptor.fallbackModels.map((id) => ({ id }));
	}

	/** Drop cached model lists, e.g. after settings changed. */
	invalidateModels(providerId?: ProviderId): void {
		if (providerId) this.modelCache.delete(providerId);
		else this.modelCache.clear();
	}

	/**
	 * End-to-end check of a provider's configuration: one very small completion
	 * that exercises the key, the endpoint and the selected model.
	 */
	async testConnection(providerId: ProviderId, signal?: AbortSignal): Promise<string> {
		const settings = this.getSettings();
		const model = settings.providers[providerId].model;
		const started = Date.now();
		await this.complete({
			providerId,
			model,
			system: 'Reply with the single word: ok',
			messages: [{ role: 'user', content: 'ok' }],
			maxOutputTokens: 16,
			signal,
		});
		const elapsed = Date.now() - started;
		return `${providerLabel(settings, providerId)} responded with ${model} in ${elapsed} ms.`;
	}

	private fingerprint(providerId: ProviderId): string {
		const provider = this.getSettings().providers[providerId];
		// Hashed so a cache key can never be read back as an API key.
		return `${provider.baseUrl}|${hash(provider.apiKey)}`;
	}
}

/** FNV-1a. Not cryptographic; only used to notice that a key changed. */
function hash(value: string): string {
	let result = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 0x01000193);
	}
	return (result >>> 0).toString(36);
}
