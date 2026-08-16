import { describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from './anthropic';
import { createGeminiAdapter } from './gemini';
import { createOpenAiCompatibleAdapter } from './openai-compatible';
import { parseOpenRouterModels } from './openrouter';
import { createAdapter } from './registry';
import { createDefaultSettings } from '../settings/types';
import type { ChatRequest } from './types';

const REQUEST: ChatRequest = {
	model: 'test-model',
	system: 'You are Aide.',
	messages: [
		{ role: 'user', content: 'first' },
		{ role: 'user', content: 'second' },
		{ role: 'assistant', content: 'reply' },
		{ role: 'user', content: '   ' },
		{ role: 'user', content: 'third' },
	],
	temperature: 0.4,
	maxOutputTokens: 1024,
};

function body(json: string | undefined): Record<string, unknown> {
	return JSON.parse(json ?? '{}') as Record<string, unknown>;
}

describe('OpenAI-compatible adapter', () => {
	const adapter = createOpenAiCompatibleAdapter({
		id: 'groq',
		label: 'Groq',
		baseUrl: 'https://api.example.com/v1/',
		apiKey: 'key-123',
	});

	it('builds a chat completions request', () => {
		const spec = adapter.buildChatRequest({ ...REQUEST, stream: true });
		expect(spec.url).toBe('https://api.example.com/v1/chat/completions');
		expect(spec.headers['Authorization']).toBe('Bearer key-123');

		const payload = body(spec.body);
		expect(payload['model']).toBe('test-model');
		expect(payload['stream']).toBe(true);
		expect(payload['temperature']).toBe(0.4);
		expect(payload['max_tokens']).toBe(1024);
		// The system prompt is a leading message, empty turns are dropped and
		// consecutive user turns are merged.
		expect(payload['messages']).toEqual([
			{ role: 'system', content: 'You are Aide.' },
			{ role: 'user', content: 'first\n\nsecond' },
			{ role: 'assistant', content: 'reply' },
			{ role: 'user', content: 'third' },
		]);
	});

	it('parses a completion response', () => {
		const result = adapter.parseChatResponse({
			model: 'served-model',
			choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 3, completion_tokens: 5 },
		});
		expect(result).toEqual({
			text: 'hello',
			model: 'served-model',
			finishReason: 'stop',
			usage: { inputTokens: 3, outputTokens: 5 },
		});
	});

	it('parses array-shaped content', () => {
		const result = adapter.parseChatResponse({
			choices: [{ message: { content: [{ type: 'text', text: 'a' }, { text: 'b' }] } }],
		});
		expect(result.text).toBe('ab');
	});

	it('parses stream deltas, completion and errors', () => {
		expect(
			adapter.parseStreamData('{"choices":[{"delta":{"content":"hi"}}]}'),
		).toEqual([{ type: 'text', text: 'hi' }]);
		expect(adapter.parseStreamData('[DONE]')).toEqual([{ type: 'done' }]);
		expect(adapter.parseStreamData('not json')).toEqual([]);
		expect(
			adapter.parseStreamData('{"error":{"message":"upstream is down"}}'),
		).toEqual([{ type: 'error', message: 'upstream is down' }]);
	});

	it('reports the finish reason from the final chunk', () => {
		expect(
			adapter.parseStreamData('{"choices":[{"delta":{},"finish_reason":"length"}]}'),
		).toEqual([{ type: 'meta', model: undefined, finishReason: 'length', usage: undefined }]);
	});

	it('extracts provider error messages', () => {
		expect(adapter.describeErrorPayload({ error: { message: 'bad key' } })).toBe('bad key');
		expect(adapter.describeErrorPayload({ error: 'flat' })).toBe('flat');
		expect(adapter.describeErrorPayload({ detail: 'nested' })).toBe('nested');
		expect(adapter.describeErrorPayload({})).toBeUndefined();
	});

	it('lists models', () => {
		expect(
			adapter.parseModelsResponse({ data: [{ id: 'a' }, { nope: true }, { id: 'b' }] }),
		).toEqual([
			{ id: 'a', name: undefined, description: undefined, contextLength: undefined },
			{ id: 'b', name: undefined, description: undefined, contextLength: undefined },
		]);
	});
});

describe('OpenAI parameter differences', () => {
	const settings = createDefaultSettings();
	settings.providers.openai.apiKey = 'sk-openai';

	it('uses max_completion_tokens', () => {
		const adapter = createAdapter(settings, 'openai');
		const payload = body(adapter.buildChatRequest({ ...REQUEST, model: 'gpt-4.1' }).body);
		expect(payload['max_completion_tokens']).toBe(1024);
		expect(payload['max_tokens']).toBeUndefined();
	});

	it('omits temperature for reasoning models that reject it', () => {
		const adapter = createAdapter(settings, 'openai');
		expect(body(adapter.buildChatRequest({ ...REQUEST, model: 'gpt-5.1' }).body)['temperature'])
			.toBeUndefined();
		expect(body(adapter.buildChatRequest({ ...REQUEST, model: 'o4-mini' }).body)['temperature'])
			.toBeUndefined();
		expect(body(adapter.buildChatRequest({ ...REQUEST, model: 'gpt-4.1' }).body)['temperature'])
			.toBe(0.4);
	});

	it('applies the same rule to OpenRouter-hosted OpenAI models', () => {
		const routed = createDefaultSettings();
		routed.providers.openrouter.apiKey = 'sk-or';
		const adapter = createAdapter(routed, 'openrouter');

		expect(
			body(adapter.buildChatRequest({ ...REQUEST, model: 'openai/gpt-5.1' }).body)[
				'temperature'
			],
		).toBeUndefined();
		expect(
			body(
				adapter.buildChatRequest({ ...REQUEST, model: 'anthropic/claude-sonnet-4.5' }).body,
			)['temperature'],
		).toBe(0.4);
	});
});

describe('Anthropic adapter', () => {
	const adapter = createAnthropicAdapter({
		apiKey: 'sk-ant',
		baseUrl: 'https://api.anthropic.com',
	});

	it('sends the version and browser-access headers', () => {
		const spec = adapter.buildChatRequest(REQUEST);
		expect(spec.url).toBe('https://api.anthropic.com/v1/messages');
		expect(spec.headers['anthropic-version']).toBe('2023-06-01');
		expect(spec.headers['x-api-key']).toBe('sk-ant');
		expect(spec.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
	});

	it('keeps the system prompt out of the message list', () => {
		const payload = body(adapter.buildChatRequest(REQUEST).body);
		expect(payload['system']).toBe('You are Aide.');
		expect(payload['messages']).toEqual([
			{ role: 'user', content: 'first\n\nsecond' },
			{ role: 'assistant', content: 'reply' },
			{ role: 'user', content: 'third' },
		]);
	});

	it('always sends max_tokens because the API requires it', () => {
		const payload = body(
			adapter.buildChatRequest({ ...REQUEST, maxOutputTokens: undefined }).body,
		);
		expect(payload['max_tokens']).toBe(4096);
	});

	it('parses text blocks and stop reasons', () => {
		expect(
			adapter.parseChatResponse({
				content: [
					{ type: 'text', text: 'a' },
					{ type: 'thinking', thinking: 'ignored' },
					{ type: 'text', text: 'b' },
				],
				model: 'claude',
				stop_reason: 'max_tokens',
				usage: { input_tokens: 1, output_tokens: 2 },
			}),
		).toEqual({
			text: 'ab',
			model: 'claude',
			finishReason: 'length',
			usage: { inputTokens: 1, outputTokens: 2 },
		});
	});

	it('maps stream events and ignores thinking deltas', () => {
		expect(
			adapter.parseStreamData(
				'{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
			),
		).toEqual([{ type: 'text', text: 'hi' }]);
		expect(
			adapter.parseStreamData(
				'{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}',
			),
		).toEqual([]);
		expect(adapter.parseStreamData('{"type":"message_stop"}')).toEqual([{ type: 'done' }]);
		expect(
			adapter.parseStreamData('{"type":"error","error":{"message":"overloaded"}}'),
		).toEqual([{ type: 'error', message: 'overloaded' }]);
	});

	it('parses the models listing', () => {
		expect(
			adapter.parseModelsResponse({
				data: [{ id: 'claude-x', display_name: 'Claude X', max_input_tokens: 200000 }],
			}),
		).toEqual([{ id: 'claude-x', name: 'Claude X', contextLength: 200000 }]);
	});
});

describe('Gemini adapter', () => {
	const adapter = createGeminiAdapter({
		apiKey: 'goog-key',
		baseUrl: 'https://generativelanguage.googleapis.com',
	});

	it('targets generateContent and streamGenerateContent', () => {
		expect(adapter.buildChatRequest({ ...REQUEST, model: 'gemini-2.5-flash' }).url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
		);
		expect(
			adapter.buildChatRequest({ ...REQUEST, model: 'models/gemini-2.5-flash', stream: true })
				.url,
		).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
		);
	});

	it('sends the key as a header, never in the URL', () => {
		const spec = adapter.buildChatRequest(REQUEST);
		expect(spec.headers['x-goog-api-key']).toBe('goog-key');
		expect(spec.url).not.toContain('goog-key');
	});

	it('maps assistant turns to the model role', () => {
		const payload = body(adapter.buildChatRequest(REQUEST).body);
		expect(payload['contents']).toEqual([
			{ role: 'user', parts: [{ text: 'first\n\nsecond' }] },
			{ role: 'model', parts: [{ text: 'reply' }] },
			{ role: 'user', parts: [{ text: 'third' }] },
		]);
		expect(payload['systemInstruction']).toEqual({ parts: [{ text: 'You are Aide.' }] });
		expect(payload['generationConfig']).toEqual({ temperature: 0.4, maxOutputTokens: 1024 });
	});

	it('parses candidates and safety blocks', () => {
		expect(
			adapter.parseChatResponse({
				candidates: [
					{ content: { parts: [{ text: 'x' }, { text: 'y' }] }, finishReason: 'SAFETY' },
				],
				modelVersion: 'gemini-2.5-flash',
				usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
			}),
		).toEqual({
			text: 'xy',
			model: 'gemini-2.5-flash',
			finishReason: 'content-filter',
			usage: { inputTokens: 4, outputTokens: 6 },
		});
	});

	it('reports a blocked prompt', () => {
		expect(
			adapter.describeErrorPayload({ promptFeedback: { blockReason: 'SAFETY' } }),
		).toBe('Prompt blocked (SAFETY).');
	});

	it('keeps only models that can generate content', () => {
		expect(
			adapter.parseModelsResponse({
				models: [
					{
						name: 'models/gemini-2.5-flash',
						displayName: 'Gemini 2.5 Flash',
						supportedGenerationMethods: ['generateContent'],
						inputTokenLimit: 1000000,
					},
					{
						name: 'models/text-embedding-004',
						supportedGenerationMethods: ['embedContent'],
					},
				],
			}),
		).toEqual([
			{
				id: 'gemini-2.5-flash',
				name: 'Gemini 2.5 Flash',
				description: undefined,
				contextLength: 1000000,
			},
		]);
	});
});

describe('OpenRouter model listing', () => {
	it('surfaces pricing and context length', () => {
		const models = parseOpenRouterModels({
			data: [
				{
					id: 'z/model',
					name: 'Z Model',
					context_length: 128000,
					pricing: { prompt: '0.000003', completion: '0.000015' },
				},
				{
					id: 'a/free',
					name: 'A Free',
					pricing: { prompt: '0', completion: '0' },
				},
			],
		});
		expect(models.map((model) => model.id)).toEqual(['a/free', 'z/model']);
		expect(models[0]?.badge).toBe('free');
		expect(models[1]?.badge).toBe('$3.00/M in · $15.00/M out');
		expect(models[1]?.contextLength).toBe(128000);
	});
});
