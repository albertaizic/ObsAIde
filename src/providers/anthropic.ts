import { getArray, getNumber, getRecord, getString, isRecord, parseJson } from './json';
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

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * `max_tokens` is required by the Messages API, so a value is always sent even
 * when the user has not chosen one.
 */
const DEFAULT_MAX_TOKENS = 4096;

const STOP_REASONS: Record<string, FinishReason> = {
	end_turn: 'stop',
	stop_sequence: 'stop',
	max_tokens: 'length',
	tool_use: 'tool-use',
	refusal: 'content-filter',
};

function mapStopReason(value: string | undefined): FinishReason | undefined {
	if (!value) return undefined;
	return STOP_REASONS[value] ?? 'unknown';
}

function readUsage(usage: unknown): TokenUsage | undefined {
	if (!isRecord(usage)) return undefined;
	const inputTokens = getNumber(usage, 'input_tokens');
	const outputTokens = getNumber(usage, 'output_tokens');
	if (inputTokens === undefined && outputTokens === undefined) return undefined;
	return { inputTokens, outputTokens };
}

export function describeAnthropicError(payload: unknown): string | undefined {
	const message = getString(getRecord(payload, 'error'), 'message');
	if (message) return message;
	return getString(payload, 'message');
}

export function parseAnthropicModels(payload: unknown): ModelInfo[] {
	const models: ModelInfo[] = [];
	for (const entry of getArray(payload, 'data')) {
		const id = getString(entry, 'id');
		if (!id) continue;
		models.push({
			id,
			name: getString(entry, 'display_name'),
			contextLength: getNumber(entry, 'max_input_tokens'),
		});
	}
	return models;
}

export function createAnthropicAdapter(connection: ProviderConnection): ProviderAdapter {
	const baseUrl = connection.baseUrl.replace(/\/+$/, '');

	function headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'anthropic-version': ANTHROPIC_VERSION,
			'x-api-key': connection.apiKey,
			// Obsidian's renderer is a browser context; without this header the
			// Messages API refuses the cross-origin request outright.
			'anthropic-dangerous-direct-browser-access': 'true',
		};
	}

	return {
		id: 'anthropic',
		label: 'Anthropic',
		capabilities: {
			streaming: true,
			modelDiscovery: true,
			systemPrompt: true,
			temperature: true,
			maxOutputTokens: true,
		},

		buildChatRequest(request: ChatRequest): HttpRequestSpec {
			const body: Record<string, unknown> = {
				model: request.model,
				max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
				messages: normalizeMessages(request.messages),
				stream: request.stream === true,
			};
			if (request.system?.trim()) body['system'] = request.system.trim();
			if (request.temperature !== undefined) body['temperature'] = request.temperature;

			return {
				url: `${baseUrl}/v1/messages`,
				method: 'POST',
				headers: headers(),
				body: JSON.stringify(body),
			};
		},

		parseChatResponse(payload: unknown): ChatResult {
			const text = getArray(payload, 'content')
				.filter((block) => getString(block, 'type') === 'text')
				.map((block) => getString(block, 'text') ?? '')
				.join('');
			return {
				text,
				model: getString(payload, 'model'),
				finishReason: mapStopReason(getString(payload, 'stop_reason')),
				usage: readUsage(isRecord(payload) ? payload['usage'] : undefined),
			};
		},

		parseStreamData(data: string): StreamEvent[] {
			const payload = parseJson(data);
			if (payload === undefined) return [];
			const type = getString(payload, 'type');

			switch (type) {
				case 'content_block_delta': {
					const delta = getRecord(payload, 'delta');
					// `thinking_delta` and `input_json_delta` are intentionally ignored.
					if (getString(delta, 'type') !== 'text_delta') return [];
					const text = getString(delta, 'text');
					return text ? [{ type: 'text', text }] : [];
				}
				case 'message_start': {
					const message = getRecord(payload, 'message');
					return [
						{
							type: 'meta',
							model: getString(message, 'model'),
							usage: readUsage(message?.['usage']),
						},
					];
				}
				case 'message_delta': {
					const delta = getRecord(payload, 'delta');
					return [
						{
							type: 'meta',
							finishReason: mapStopReason(getString(delta, 'stop_reason')),
							usage: readUsage(isRecord(payload) ? payload['usage'] : undefined),
						},
					];
				}
				case 'message_stop':
					return [{ type: 'done' }];
				case 'error': {
					const message = describeAnthropicError(payload);
					return [{ type: 'error', message: message ?? 'Stream error.' }];
				}
				default:
					return [];
			}
		},

		buildModelsRequest(): HttpRequestSpec {
			return { url: `${baseUrl}/v1/models?limit=1000`, method: 'GET', headers: headers() };
		},

		parseModelsResponse: parseAnthropicModels,
		describeErrorPayload: describeAnthropicError,
	};
}
