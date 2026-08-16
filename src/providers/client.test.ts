import { describe, expect, it, vi } from 'vitest';
import { listModels, runChat } from './client';
import { AideError } from './errors';
import type { HttpClient, HttpResponse, HttpStreamResponse } from './http';
import { createOpenAiCompatibleAdapter } from './openai-compatible';
import type { ChatRequest, HttpRequestSpec } from './types';

const adapter = createOpenAiCompatibleAdapter({
	id: 'openrouter',
	label: 'OpenRouter',
	baseUrl: 'https://example.test/v1',
	apiKey: 'secret-key-abcdefgh',
});

const request: ChatRequest = {
	model: 'demo',
	messages: [{ role: 'user', content: 'hi' }],
};

async function* chunks(...values: string[]): AsyncGenerator<string> {
	for (const value of values) yield value;
}

/** Fake transport; no test in this suite touches the network. */
function createHttp(overrides: Partial<HttpClient>): HttpClient {
	return {
		request: () => Promise.reject(new Error('request not stubbed')),
		openStream: () => Promise.resolve(null),
		...overrides,
	};
}

function sse(...payloads: string[]): string[] {
	return payloads.map((payload) => `data: ${payload}\n\n`);
}

describe('runChat streaming', () => {
	it('assembles streamed deltas and reports them in order', async () => {
		const http = createHttp({
			openStream: (): Promise<HttpStreamResponse> =>
				Promise.resolve({
					status: 200,
					body: chunks(
						...sse(
							'{"choices":[{"delta":{"content":"Hel"}}]}',
							'{"choices":[{"delta":{"content":"lo"}}],"model":"demo"}',
							'[DONE]',
						),
					),
				}),
		});

		const seen: string[] = [];
		const result = await runChat(adapter, request, http, {
			onText: (delta) => seen.push(delta),
		});

		expect(seen).toEqual(['Hel', 'lo']);
		expect(result.text).toBe('Hello');
		expect(result.model).toBe('demo');
	});

	it('falls back to a buffered request when streaming is unavailable', async () => {
		const requestSpy = vi.fn(
			(spec: HttpRequestSpec): Promise<HttpResponse> => {
				expect(JSON.parse(spec.body ?? '{}')).toMatchObject({ stream: false });
				return Promise.resolve({
					status: 200,
					text: JSON.stringify({ choices: [{ message: { content: 'buffered' } }] }),
				});
			},
		);
		const http = createHttp({
			openStream: () => Promise.resolve(null),
			request: requestSpy,
		});

		const result = await runChat(adapter, request, http, {});
		expect(result.text).toBe('buffered');
		expect(requestSpy).toHaveBeenCalledOnce();
	});

	it('classifies a failed streaming response from its body', async () => {
		const http = createHttp({
			openStream: (): Promise<HttpStreamResponse> =>
				Promise.resolve({
					status: 401,
					body: chunks('{"error":{"message":"Incorrect API key"}}'),
				}),
		});

		await expect(runChat(adapter, request, http, {})).rejects.toMatchObject({
			kind: 'authentication',
		});
	});

	it('surfaces an error reported inside a 200 stream', async () => {
		const http = createHttp({
			openStream: (): Promise<HttpStreamResponse> =>
				Promise.resolve({
					status: 200,
					body: chunks(...sse('{"error":{"message":"upstream failed"}}')),
				}),
		});

		await expect(runChat(adapter, request, http, {})).rejects.toMatchObject({
			kind: 'server',
		});
	});

	it('reports an interrupted stream instead of a truncated answer', async () => {
		async function* broken(): AsyncGenerator<string> {
			yield 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
			throw new Error('socket closed');
		}
		const http = createHttp({
			openStream: (): Promise<HttpStreamResponse> =>
				Promise.resolve({ status: 200, body: broken() }),
		});

		await expect(runChat(adapter, request, http, {})).rejects.toMatchObject({
			kind: 'stream-interrupted',
		});
	});

	it('keeps what was generated when the user stops', async () => {
		const controller = new AbortController();
		async function* stopped(): AsyncGenerator<string> {
			yield 'data: {"choices":[{"delta":{"content":"half"}}]}\n\n';
			controller.abort();
			const error = new Error('aborted');
			error.name = 'AbortError';
			throw error;
		}
		const http = createHttp({
			openStream: (): Promise<HttpStreamResponse> =>
				Promise.resolve({ status: 200, body: stopped() }),
		});

		const result = await runChat(adapter, request, http, { signal: controller.signal });
		expect(result.text).toBe('half');
	});
});

describe('runChat buffered', () => {
	it('classifies HTTP failures and keeps the provider wording', async () => {
		const http = createHttp({
			request: (): Promise<HttpResponse> =>
				Promise.resolve({
					status: 429,
					text: JSON.stringify({ error: { message: 'Rate limit reached' } }),
				}),
		});

		await expect(
			runChat(adapter, request, http, { stream: false }),
		).rejects.toMatchObject({
			kind: 'rate-limit',
			providerMessage: 'Rate limit reached',
		});
	});

	it('rejects an unreadable body', async () => {
		const http = createHttp({
			request: (): Promise<HttpResponse> => Promise.resolve({ status: 200, text: '<html>' }),
		});

		await expect(
			runChat(adapter, request, http, { stream: false }),
		).rejects.toMatchObject({ kind: 'malformed-response' });
	});

	it('rejects an empty completion', async () => {
		const http = createHttp({
			request: (): Promise<HttpResponse> =>
				Promise.resolve({
					status: 200,
					text: JSON.stringify({ choices: [{ message: { content: '' } }] }),
				}),
		});

		await expect(
			runChat(adapter, request, http, { stream: false }),
		).rejects.toMatchObject({ kind: 'empty-response' });
	});

	it('refuses to start once the request is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			runChat(adapter, request, createHttp({}), { signal: controller.signal }),
		).rejects.toBeInstanceOf(AideError);
	});
});

describe('listModels', () => {
	it('parses the provider listing', async () => {
		const http = createHttp({
			request: (spec): Promise<HttpResponse> => {
				expect(spec.url).toBe('https://example.test/v1/models');
				return Promise.resolve({
					status: 200,
					text: JSON.stringify({ data: [{ id: 'one' }] }),
				});
			},
		});

		const models = await listModels(adapter, http);
		expect(models.map((model) => model.id)).toEqual(['one']);
	});

	it('propagates a classified failure', async () => {
		const http = createHttp({
			request: (): Promise<HttpResponse> =>
				Promise.resolve({ status: 401, text: '{"error":{"message":"bad key"}}' }),
		});

		await expect(listModels(adapter, http)).rejects.toMatchObject({
			kind: 'authentication',
		});
	});
});
