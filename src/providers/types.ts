/**
 * The vocabulary every part of ObsAIde shares when talking about AI.
 *
 * Nothing outside `src/providers` should know which HTTP API is behind a
 * provider: adapters translate this vocabulary to and from the wire format.
 */

export type ProviderId =
	| 'openrouter'
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'groq'
	| 'mistral'
	| 'custom';

export const PROVIDER_IDS: readonly ProviderId[] = [
	'openrouter',
	'openai',
	'anthropic',
	'gemini',
	'groq',
	'mistral',
	'custom',
];

export function isProviderId(value: unknown): value is ProviderId {
	return (
		typeof value === 'string' &&
		(PROVIDER_IDS as readonly string[]).includes(value)
	);
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
	role: ChatRole;
	content: string;
}

export interface ChatRequest {
	model: string;
	/** Conversation turns, oldest first. Must start with a user message. */
	messages: ChatMessage[];
	/** System / custom instructions, sent through each provider's own channel. */
	system?: string;
	temperature?: number;
	maxOutputTokens?: number;
	stream?: boolean;
}

export type FinishReason =
	| 'stop'
	| 'length'
	| 'content-filter'
	| 'tool-use'
	| 'unknown';

export interface TokenUsage {
	inputTokens?: number;
	outputTokens?: number;
}

export interface ChatResult {
	text: string;
	model?: string;
	finishReason?: FinishReason;
	usage?: TokenUsage;
}

/** Normalised streaming events. Adapters never leak provider event shapes. */
export type StreamEvent =
	| { type: 'text'; text: string }
	| { type: 'meta'; model?: string; finishReason?: FinishReason; usage?: TokenUsage }
	/** Providers can report a failure inside an otherwise healthy 200 stream. */
	| { type: 'error'; message: string }
	| { type: 'done' };

export interface ModelInfo {
	id: string;
	name?: string;
	description?: string;
	contextLength?: number;
	/** Free-form label shown next to the model, e.g. pricing for OpenRouter. */
	badge?: string;
}

export interface HttpRequestSpec {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

export interface ProviderCapabilities {
	/** The provider's HTTP API can stream; the environment may still refuse. */
	streaming: boolean;
	modelDiscovery: boolean;
	systemPrompt: boolean;
	temperature: boolean;
	maxOutputTokens: boolean;
}

/** Everything an adapter needs in order to talk to an endpoint. */
export interface ProviderConnection {
	apiKey: string;
	/** Fully resolved base URL, without a trailing slash. */
	baseUrl: string;
	label?: string;
}

export interface ProviderAdapter {
	readonly id: ProviderId;
	readonly label: string;
	readonly capabilities: ProviderCapabilities;

	buildChatRequest(request: ChatRequest): HttpRequestSpec;
	parseChatResponse(payload: unknown): ChatResult;

	/**
	 * Translate one SSE `data:` payload into zero or more normalised events.
	 * Adapters must tolerate keep-alive noise and unknown event types.
	 */
	parseStreamData(data: string): StreamEvent[];

	/** `null` when the provider has no usable model listing endpoint. */
	buildModelsRequest(): HttpRequestSpec | null;
	parseModelsResponse(payload: unknown): ModelInfo[];

	/** Best-effort human readable message from a provider error body. */
	describeErrorPayload(payload: unknown): string | undefined;
}

/**
 * Merge adjacent same-role turns and drop empty ones.
 *
 * Anthropic and Gemini reject conversations that do not strictly alternate, and
 * every provider rejects empty content, so all adapters run this first.
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
	const result: ChatMessage[] = [];
	for (const message of messages) {
		const content = message.content.trim();
		if (!content) continue;
		const previous = result[result.length - 1];
		if (previous && previous.role === message.role) {
			previous.content = `${previous.content}\n\n${content}`;
			continue;
		}
		result.push({ role: message.role, content });
	}
	return result;
}
