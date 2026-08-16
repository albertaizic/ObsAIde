import type { ProviderId } from './types';

/**
 * What sampling parameters a given provider and model will actually accept.
 *
 * Providers differ here in ways that produce hard 400s rather than graceful
 * degradation, so the rules live in one table instead of being rediscovered in
 * each adapter or, worse, in the settings UI.
 */
export interface TemperatureSupport {
	supported: boolean;
	/** Highest value the provider documents for this model. */
	max: number;
	/** Why it is unsupported, for diagnostics. Never shown with a key. */
	reason?: string;
}

/**
 * OpenAI's reasoning families reject `temperature` outright.
 *
 * The same model IDs appear on OpenRouter behind an `openai/` prefix, so the
 * check runs against the part after the last slash too.
 */
const OPENAI_REASONING = /^(o\d|gpt-5)/i;

/** Providers that document temperature only up to 1.0. */
const MAX_BY_PROVIDER: Partial<Record<ProviderId, number>> = {
	anthropic: 1,
	mistral: 1,
	groq: 2,
	openai: 2,
	gemini: 2,
	openrouter: 2,
	custom: 2,
};

function bareModelName(model: string): string {
	const slash = model.lastIndexOf('/');
	return slash === -1 ? model : model.slice(slash + 1);
}

export function getTemperatureSupport(
	providerId: ProviderId,
	model: string,
): TemperatureSupport {
	const max = MAX_BY_PROVIDER[providerId] ?? 1;

	const looksLikeOpenAiReasoning =
		OPENAI_REASONING.test(model) || OPENAI_REASONING.test(bareModelName(model));

	// OpenRouter and custom gateways proxy OpenAI models unchanged, so the same
	// restriction applies there.
	const proxiesOpenAi =
		providerId === 'openai' || providerId === 'openrouter' || providerId === 'custom';

	if (proxiesOpenAi && looksLikeOpenAiReasoning) {
		return {
			supported: false,
			max,
			reason: 'This model family rejects the temperature parameter.',
		};
	}

	return { supported: true, max };
}

export function supportsTemperature(providerId: ProviderId, model: string): boolean {
	return getTemperatureSupport(providerId, model).supported;
}

/**
 * The temperature to actually send, or `undefined` to omit the parameter.
 *
 * Values are clamped to what the provider documents, so a setting that is legal
 * in ObsAIde can never become an out-of-range request.
 */
export function resolveTemperature(
	providerId: ProviderId,
	model: string,
	requested: number | undefined,
): number | undefined {
	if (requested === undefined || !Number.isFinite(requested)) return undefined;
	const support = getTemperatureSupport(providerId, model);
	if (!support.supported) return undefined;
	return Math.min(support.max, Math.max(0, requested));
}
