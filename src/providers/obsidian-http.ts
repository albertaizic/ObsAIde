import { requestUrl } from 'obsidian';
import { AideError, isAbortError } from './errors';
import type { HttpClient, HttpResponse, HttpStreamResponse } from './http';
import type { HttpRequestSpec } from './types';

/**
 * Obsidian-flavoured transport.
 *
 * Buffered requests go through `requestUrl`, which is not subject to CORS and
 * therefore works with every provider on desktop and mobile. Streaming needs a
 * readable body, which only `fetch` provides, so streams use `fetch` and quietly
 * degrade to the buffered path when the environment refuses the request.
 */
export class ObsidianHttpClient implements HttpClient {
	/** Origins where `fetch` has already proven unusable in this session. */
	private readonly streamingBlocked = new Set<string>();

	async request(spec: HttpRequestSpec, signal?: AbortSignal): Promise<HttpResponse> {
		if (signal?.aborted) throw new AideError('aborted', 'Generation stopped.');
		try {
			const response = await requestUrl({
				url: spec.url,
				method: spec.method,
				headers: spec.headers,
				body: spec.body,
				throw: false,
			});
			// `requestUrl` cannot be cancelled; check once it settles so a stop
			// during a buffered request still ends as an abort.
			if (signal?.aborted) throw new AideError('aborted', 'Generation stopped.');
			return { status: response.status, text: response.text };
		} catch (error) {
			if (error instanceof AideError) throw error;
			throw new AideError('network', 'Could not reach the provider.', { cause: error });
		}
	}

	async openStream(
		spec: HttpRequestSpec,
		signal?: AbortSignal,
	): Promise<HttpStreamResponse | null> {
		const origin = safeOrigin(spec.url);
		if (this.streamingBlocked.has(origin)) return null;

		let response: Response;
		try {
			// `requestUrl` buffers the whole body, so it cannot stream. This is
			// the only place `fetch` is used, and a failure here falls back to
			// `requestUrl` (see `openStream`'s callers).
			response = await fetch(spec.url, {
				method: spec.method,
				headers: spec.headers,
				body: spec.body,
				signal,
			});
		} catch (error) {
			if (isAbortError(error) || signal?.aborted) {
				throw new AideError('aborted', 'Generation stopped.');
			}
			// A transport-level rejection here is almost always the renderer's
			// CORS check. Remember it and let the caller use the buffered path.
			this.streamingBlocked.add(origin);
			return null;
		}

		if (!response.body) {
			this.streamingBlocked.add(origin);
			return null;
		}

		return { status: response.status, body: readBody(response.body, signal) };
	}
}

function safeOrigin(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
}

async function* readBody(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (signal?.aborted) throw new AideError('aborted', 'Generation stopped.');
			if (value) yield decoder.decode(value, { stream: true });
		}
		const tail = decoder.decode();
		if (tail) yield tail;
	} finally {
		// Releasing the lock lets the underlying connection be torn down when
		// the consumer stops early (for example when the user presses stop).
		reader.releaseLock();
		if (signal?.aborted) void body.cancel().catch(() => undefined);
	}
}
