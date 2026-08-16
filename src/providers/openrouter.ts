import { getArray, getNumber, getRecord, getString } from './json';
import type { ModelInfo } from './types';

/**
 * OpenRouter exposes several hundred models, so its listing is parsed with a
 * little extra care: price and context length are what people actually browse
 * by, and both are shown in the model picker.
 */
function formatPrice(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const perToken = Number(raw);
	if (!Number.isFinite(perToken)) return undefined;
	if (perToken === 0) return 'free';
	const perMillion = perToken * 1_000_000;
	const digits = perMillion >= 1 ? 2 : 3;
	return `$${perMillion.toFixed(digits)}/M`;
}

function buildBadge(entry: unknown): string | undefined {
	const pricing = getRecord(entry, 'pricing');
	const prompt = formatPrice(getString(pricing, 'prompt'));
	const completion = formatPrice(getString(pricing, 'completion'));
	if (prompt === 'free' && (completion === 'free' || completion === undefined)) {
		return 'free';
	}
	if (prompt && completion) return `${prompt} in · ${completion} out`;
	return prompt ?? completion;
}

export function parseOpenRouterModels(payload: unknown): ModelInfo[] {
	const models: ModelInfo[] = [];
	for (const entry of getArray(payload, 'data')) {
		const id = getString(entry, 'id');
		if (!id) continue;
		models.push({
			id,
			name: getString(entry, 'name'),
			description: getString(entry, 'description'),
			contextLength: getNumber(entry, 'context_length'),
			badge: buildBadge(entry),
		});
	}
	models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
	return models;
}
