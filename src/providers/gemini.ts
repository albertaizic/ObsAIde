import { getArray, getNumber, getRecord, getString, parseJson } from './json';
import {
	normalizeMessages,
	type ChatRequest,
	type ChatResult,
	type FinishReason,
	type HttpRequestSpec,
	type ModelInfo,
	type ProviderAdapter,
	type ProviderConnection,
	type StreamEvent,
	type TokenUsage,
} from './types';

const FINISH_REASONS: Record<string, FinishReason> = {
	STOP: 'stop',
	MAX_TOKENS: 'length',
	SAFETY: 'content-filter',
	RECITATION: 'content-filter',
	PROHIBITED_CONTENT: 'content-filter',
	BLOCKLIST: 'content-filter',
	SPII: 'content-filter',
	MALFORMED_FUNCTION_CALL: 'tool-use',
};

function mapFinishReason(value: string | undefined): FinishReason | undefined {
	if (!value || value === 'FINISH_REASON_UNSPECIFIED') return undefined;
	return FINISH_REASONS[value] ?? 'unknown';
}

/** Gemini accepts both `gemini-2.5-flash` and `models/gemini-2.5-flash`. */
function stripModelPrefix(model: string): string {
	return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

function readCandidateText(payload: unknown): string {
	const candidate = getArray(payload, 'candidates')[0];
	const content = getRecord(candidate, 'content');
	return getArray(content, 'parts')
		.map((part) => getString(part, 'text') ?? '')
		.join('');
}

function readUsage(payload: unknown): TokenUsage | undefined {
	const usage = getRecord(payload, 'usageMetadata');
	if (!usage) return undefined;
	const inputTokens = getNumber(usage, 'promptTokenCount');
	const outputTokens = getNumber(usage, 'candidatesTokenCount');
	if (inputTokens === undefined && outputTokens === undefined) return undefined;
	return { inputTokens, outputTokens };
}

export function describeGeminiError(payload: unknown): string | undefined {
	const error = getRecord(payload, 'error');
	const message = getString(error, 'message');
	if (message) return message;
	// A prompt can be refused without an `error` object at all.
	const feedback = getRecord(payload, 'promptFeedback');
	const blockReason = getString(feedback, 'blockReason');
	if (blockReason) return `Prompt blocked (${blockReason}).`;
	return getString(payload, 'message');
}

export function parseGeminiModels(payload: unknown): ModelInfo[] {
	const models: ModelInfo[] = [];
	for (const entry of getArray(payload, 'models')) {
		const name = getString(entry, 'name');
		if (!name) continue;
		const methods = getArray(entry, 'supportedGenerationMethods').filter(
			(method): method is string => typeof method === 'string',
		);
		// Embedding and media models share the listing endpoint; skip them.
		if (methods.length > 0 && !methods.includes('generateContent')) continue;
		models.push({
			id: stripModelPrefix(name),
			name: getString(entry, 'displayName'),
			description: getString(entry, 'description'),
			contextLength: getNumber(entry, 'inputTokenLimit'),
		});
	}
	return models;
}

export function createGeminiAdapter(connection: ProviderConnection): ProviderAdapter {
	const baseUrl = connection.baseUrl.replace(/\/+$/, '');

	function headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			// Sent as a header rather than a query parameter so the key never
			// ends up in a URL that could be logged.
			'x-goog-api-key': connection.apiKey,
		};
	}

	return {
		id: 'gemini',
		label: 'Google Gemini',
		capabilities: {
			streaming: true,
			modelDiscovery: true,
			systemPrompt: true,
			temperature: true,
			maxOutputTokens: true,
		},

		buildChatRequest(request: ChatRequest): HttpRequestSpec {
			const contents = normalizeMessages(request.messages).map((message) => ({
				role: message.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: message.content }],
			}));

			const generationConfig: Record<string, unknown> = {};
			if (request.temperature !== undefined) {
				generationConfig['temperature'] = request.temperature;
			}
			if (request.maxOutputTokens !== undefined) {
				generationConfig['maxOutputTokens'] = request.maxOutputTokens;
			}

			const body: Record<string, unknown> = { contents };
			if (request.system?.trim()) {
				body['systemInstruction'] = { parts: [{ text: request.system.trim() }] };
			}
			if (Object.keys(generationConfig).length > 0) {
				body['generationConfig'] = generationConfig;
			}

			const model = stripModelPrefix(request.model);
			const method = request.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';

			return {
				url: `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:${method}`,
				method: 'POST',
				headers: headers(),
				body: JSON.stringify(body),
			};
		},

		parseChatResponse(payload: unknown): ChatResult {
			const candidate = getArray(payload, 'candidates')[0];
			return {
				text: readCandidateText(payload),
				model: getString(payload, 'modelVersion'),
				finishReason: mapFinishReason(getString(candidate, 'finishReason')),
				usage: readUsage(payload),
			};
		},

		parseStreamData(data: string): StreamEvent[] {
			const payload = parseJson(data);
			if (payload === undefined) return [];
			if (getRecord(payload, 'error')) {
				return [
					{ type: 'error', message: describeGeminiError(payload) ?? 'Stream error.' },
				];
			}

			const events: StreamEvent[] = [];
			const text = readCandidateText(payload);
			if (text) events.push({ type: 'text', text });

			const candidate = getArray(payload, 'candidates')[0];
			const finishReason = mapFinishReason(getString(candidate, 'finishReason'));
			const usage = readUsage(payload);
			const model = getString(payload, 'modelVersion');
			if (finishReason || usage || model) {
				events.push({ type: 'meta', model, finishReason, usage });
			}
			return events;
		},

		buildModelsRequest(): HttpRequestSpec {
			return {
				url: `${baseUrl}/v1beta/models?pageSize=1000`,
				method: 'GET',
				headers: headers(),
			};
		},

		parseModelsResponse: parseGeminiModels,
		describeErrorPayload: describeGeminiError,
	};
}
