import { getArray, getNumber, getRecord, getString, isRecord, parseJson } from './json';
import {
	normalizeMessages,
	type ChatRequest,
	type ChatResult,
	type FinishReason,
	type HttpRequestSpec,
	type ModelInfo,
	type ProviderAdapter,
	type ProviderCapabilities,
	type ProviderId,
	type StreamEvent,
	type TokenUsage,
} from './types';

/**
 * Shared implementation for every endpoint that speaks the OpenAI Chat
 * Completions dialect: OpenAI itself, OpenRouter, Groq, Mistral and any custom
 * server. Differences between them are expressed as options rather than as
 * branches inside the request builder.
 */
export interface OpenAiCompatibleOptions {
	id: ProviderId;
	label: string;
	baseUrl: string;
	apiKey: string;
	/** Extra headers, e.g. OpenRouter's app attribution headers. */
	extraHeaders?: Record<string, string>;
	/** `max_tokens` for most vendors, `max_completion_tokens` for OpenAI. */
	maxTokensField?: 'max_tokens' | 'max_completion_tokens';
	/** Some models reject `temperature` entirely; decided per model ID. */
	supportsTemperature?: (model: string) => boolean;
	/** Relative path of the model listing endpoint, or `null` to disable it. */
	modelsPath?: string | null;
	/** Replaces the default listing parser, e.g. to surface OpenRouter pricing. */
	parseModels?: (payload: unknown) => ModelInfo[];
}

const FINISH_REASONS: Record<string, FinishReason> = {
	stop: 'stop',
	length: 'length',
	content_filter: 'content-filter',
	tool_calls: 'tool-use',
	function_call: 'tool-use',
};

function mapFinishReason(value: string | undefined): FinishReason | undefined {
	if (!value) return undefined;
	return FINISH_REASONS[value] ?? 'unknown';
}

/** Content may be a plain string or an array of typed parts. */
function readContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => {
			if (typeof part === 'string') return part;
			return getString(part, 'text') ?? '';
		})
		.join('');
}

function readUsage(payload: unknown): TokenUsage | undefined {
	const usage = getRecord(payload, 'usage');
	if (!usage) return undefined;
	const inputTokens = getNumber(usage, 'prompt_tokens');
	const outputTokens = getNumber(usage, 'completion_tokens');
	if (inputTokens === undefined && outputTokens === undefined) return undefined;
	return { inputTokens, outputTokens };
}

export function describeOpenAiError(payload: unknown): string | undefined {
	if (typeof payload === 'string') return payload || undefined;
	const error = isRecord(payload) ? payload['error'] : undefined;
	if (typeof error === 'string') return error;
	const message = getString(error, 'message') ?? getString(payload, 'message');
	if (message) return message;
	// Some gateways report failures inside `detail` or a bare `error.metadata`.
	const detail = isRecord(payload) ? payload['detail'] : undefined;
	if (typeof detail === 'string') return detail;
	const metadata = getRecord(error, 'metadata');
	return getString(metadata, 'raw');
}

export function parseOpenAiModels(payload: unknown): ModelInfo[] {
	const entries = getArray(payload, 'data');
	const models: ModelInfo[] = [];
	for (const entry of entries) {
		const id = getString(entry, 'id');
		if (!id) continue;
		models.push({
			id,
			name: getString(entry, 'name'),
			description: getString(entry, 'description'),
			contextLength:
				getNumber(entry, 'context_length') ??
				getNumber(entry, 'max_context_length') ??
				getNumber(entry, 'max_model_len'),
		});
	}
	return models;
}

export function createOpenAiCompatibleAdapter(
	options: OpenAiCompatibleOptions,
): ProviderAdapter {
	const baseUrl = options.baseUrl.replace(/\/+$/, '');
	const maxTokensField = options.maxTokensField ?? 'max_tokens';
	const modelsPath = options.modelsPath === undefined ? '/models' : options.modelsPath;

	const capabilities: ProviderCapabilities = {
		streaming: true,
		modelDiscovery: modelsPath !== null,
		systemPrompt: true,
		temperature: true,
		maxOutputTokens: true,
	};

	function headers(): Record<string, string> {
		const result: Record<string, string> = {
			'Content-Type': 'application/json',
			...options.extraHeaders,
		};
		if (options.apiKey) {
			result['Authorization'] = `Bearer ${options.apiKey}`;
		}
		return result;
	}

	return {
		id: options.id,
		label: options.label,
		capabilities,

		buildChatRequest(request: ChatRequest): HttpRequestSpec {
			const messages: { role: string; content: string }[] = [];
			if (request.system?.trim()) {
				messages.push({ role: 'system', content: request.system.trim() });
			}
			for (const message of normalizeMessages(request.messages)) {
				messages.push({ role: message.role, content: message.content });
			}

			const body: Record<string, unknown> = {
				model: request.model,
				messages,
				stream: request.stream === true,
			};
			const allowsTemperature = options.supportsTemperature?.(request.model) ?? true;
			if (request.temperature !== undefined && allowsTemperature) {
				body['temperature'] = request.temperature;
			}
			if (request.maxOutputTokens !== undefined) {
				body[maxTokensField] = request.maxOutputTokens;
			}

			return {
				url: `${baseUrl}/chat/completions`,
				method: 'POST',
				headers: headers(),
				body: JSON.stringify(body),
			};
		},

		parseChatResponse(payload: unknown): ChatResult {
			const choice = getArray(payload, 'choices')[0];
			const message = getRecord(choice, 'message');
			const text = readContent(message?.['content']);
			return {
				text,
				model: getString(payload, 'model'),
				finishReason: mapFinishReason(getString(choice, 'finish_reason')),
				usage: readUsage(payload),
			};
		},

		parseStreamData(data: string): StreamEvent[] {
			if (data === '[DONE]') return [{ type: 'done' }];
			const payload = parseJson(data);
			if (payload === undefined) return [];

			// Gateways such as OpenRouter report upstream failures inside the
			// stream body rather than through the HTTP status.
			if (isRecord(payload) && payload['error'] !== undefined) {
				const message = describeOpenAiError(payload);
				return [{ type: 'error', message: message ?? 'Stream error.' }];
			}

			const events: StreamEvent[] = [];
			const choice = getArray(payload, 'choices')[0];
			const delta = getRecord(choice, 'delta');
			const text = readContent(delta?.['content']);
			if (text) events.push({ type: 'text', text });

			const finishReason = mapFinishReason(getString(choice, 'finish_reason'));
			const usage = readUsage(payload);
			const model = getString(payload, 'model');
			if (finishReason || usage || (model && events.length === 0)) {
				events.push({ type: 'meta', model, finishReason, usage });
			}
			return events;
		},

		buildModelsRequest(): HttpRequestSpec | null {
			if (modelsPath === null) return null;
			return { url: `${baseUrl}${modelsPath}`, method: 'GET', headers: headers() };
		},

		parseModelsResponse(payload: unknown): ModelInfo[] {
			return (options.parseModels ?? parseOpenAiModels)(payload);
		},

		describeErrorPayload: describeOpenAiError,
	};
}
