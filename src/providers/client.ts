import { redactSecrets } from '../utils/secrets';
import {
	AideError,
	buildErrorMessage,
	classifyHttpFailure,
	isAbortError,
	toAideError,
} from './errors';
import { drainStream, isOkStatus, type HttpClient } from './http';
import { parseJson } from './json';
import { SseParser } from './sse';
import type { ChatRequest, ChatResult, ModelInfo, ProviderAdapter } from './types';

export interface RunChatOptions {
	signal?: AbortSignal;
	/** Called for every streamed fragment, in order. */
	onText?: (delta: string) => void;
	/** Attempt streaming; ignored when the provider cannot stream. */
	stream?: boolean;
	/** API keys to scrub from any message that reaches the user. */
	secrets?: readonly string[];
}

/** Build an {@link AideError} from a failed HTTP response body. */
function failureFromResponse(
	adapter: ProviderAdapter,
	status: number,
	bodyText: string,
	secrets: readonly string[],
): AideError {
	const payload = parseJson(bodyText);
	const rawMessage =
		adapter.describeErrorPayload(payload ?? bodyText) ??
		(bodyText.trim() ? bodyText.trim().slice(0, 300) : undefined);
	const providerMessage = rawMessage ? redactSecrets(rawMessage, secrets) : undefined;
	const kind = classifyHttpFailure(status, providerMessage);
	return new AideError(kind, buildErrorMessage(kind, providerMessage), {
		status,
		providerMessage,
	});
}

function finishResult(result: ChatResult): ChatResult {
	if (result.text.trim()) return result;
	if (result.finishReason === 'content-filter') {
		throw new AideError(
			'invalid-request',
			'The provider blocked this response as filtered content.',
		);
	}
	throw new AideError(
		'empty-response',
		'The provider returned an empty response. Try again or pick another model.',
	);
}

async function runStreaming(
	adapter: ProviderAdapter,
	request: ChatRequest,
	http: HttpClient,
	options: RunChatOptions,
): Promise<ChatResult | null> {
	const secrets = options.secrets ?? [];
	const spec = adapter.buildChatRequest({ ...request, stream: true });
	const response = await http.openStream(spec, options.signal);
	if (!response) return null;

	if (!isOkStatus(response.status)) {
		const bodyText = await drainStream(response.body);
		throw failureFromResponse(adapter, response.status, bodyText, secrets);
	}

	const parser = new SseParser();
	const result: ChatResult = { text: '' };
	let sawAnyEvent = false;
	let completed = false;

	const consume = (payloads: string[]): void => {
		for (const payload of payloads) {
			for (const event of adapter.parseStreamData(payload)) {
				sawAnyEvent = true;
				switch (event.type) {
					case 'text':
						result.text += event.text;
						options.onText?.(event.text);
						break;
					case 'meta':
						if (event.model) result.model = event.model;
						if (event.finishReason) result.finishReason = event.finishReason;
						if (event.usage) result.usage = { ...result.usage, ...event.usage };
						break;
					case 'error': {
						const message = redactSecrets(event.message, secrets);
						throw new AideError('server', buildErrorMessage('server', message), {
							providerMessage: message,
						});
					}
					case 'done':
						completed = true;
						break;
				}
			}
		}
	};

	try {
		for await (const chunk of response.body) {
			consume(parser.push(chunk));
		}
		consume(parser.flush());
	} catch (error) {
		if (isAbortError(error) || options.signal?.aborted) {
			// Keep whatever arrived before the user pressed stop.
			if (result.text.trim()) return { ...result, finishReason: 'stop' };
			throw new AideError('aborted', 'Generation stopped.');
		}
		if (error instanceof AideError) throw error;
		if (result.text.trim()) {
			// Whatever streamed is already on screen; say plainly that the rest
			// never arrived instead of presenting a truncated answer as final.
			throw new AideError(
				'stream-interrupted',
				'The response stream ended unexpectedly. The reply above is incomplete.',
				{ cause: error },
			);
		}
		throw toAideError(error, secrets);
	}

	if (!sawAnyEvent) {
		// The endpoint answered 200 but produced nothing we can read; the
		// buffered path gives a much better error message.
		return null;
	}
	if (!completed && !result.text.trim()) {
		throw new AideError('stream-interrupted', 'The response stream ended unexpectedly.');
	}
	return finishResult(result);
}

async function runBuffered(
	adapter: ProviderAdapter,
	request: ChatRequest,
	http: HttpClient,
	options: RunChatOptions,
): Promise<ChatResult> {
	const secrets = options.secrets ?? [];
	const spec = adapter.buildChatRequest({ ...request, stream: false });
	const response = await http.request(spec, options.signal);

	if (!isOkStatus(response.status)) {
		throw failureFromResponse(adapter, response.status, response.text, secrets);
	}

	const payload = parseJson(response.text);
	if (payload === undefined) {
		throw new AideError(
			'malformed-response',
			'The provider returned a response ObsAIde could not read.',
		);
	}

	const result = adapter.parseChatResponse(payload);
	if (!result.text.trim()) {
		// Some providers answer 200 with an error object in the body.
		const described = adapter.describeErrorPayload(payload);
		if (described) {
			const message = redactSecrets(described, secrets);
			throw new AideError('server', buildErrorMessage('server', message), {
				providerMessage: message,
			});
		}
	}
	const finished = finishResult(result);
	options.onText?.(finished.text);
	return finished;
}

/**
 * Run one completion, streaming when possible and falling back to a buffered
 * request when the environment or the provider will not cooperate.
 */
export async function runChat(
	adapter: ProviderAdapter,
	request: ChatRequest,
	http: HttpClient,
	options: RunChatOptions = {},
): Promise<ChatResult> {
	if (options.signal?.aborted) throw new AideError('aborted', 'Generation stopped.');

	if (options.stream !== false && adapter.capabilities.streaming) {
		const streamed = await runStreaming(adapter, request, http, options);
		if (streamed) return streamed;
	}
	return runBuffered(adapter, request, http, options);
}

/** Fetch the provider's model catalogue. Returns `[]` when unsupported. */
export async function listModels(
	adapter: ProviderAdapter,
	http: HttpClient,
	options: { signal?: AbortSignal; secrets?: readonly string[] } = {},
): Promise<ModelInfo[]> {
	const spec = adapter.buildModelsRequest();
	if (!spec) return [];

	const response = await http.request(spec, options.signal);
	if (!isOkStatus(response.status)) {
		throw failureFromResponse(adapter, response.status, response.text, options.secrets ?? []);
	}
	const payload = parseJson(response.text);
	if (payload === undefined) {
		throw new AideError(
			'malformed-response',
			'The provider returned a model list ObsAIde could not read.',
		);
	}
	return adapter.parseModelsResponse(payload);
}
