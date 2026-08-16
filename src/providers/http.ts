import type { HttpRequestSpec } from './types';

/**
 * The transport contract the provider layer depends on.
 *
 * Keeping it an interface means adapters and the chat client can be tested
 * without Obsidian and without touching the network.
 */
export interface HttpResponse {
	status: number;
	text: string;
}

export interface HttpStreamResponse {
	status: number;
	/** Decoded text chunks, in order. */
	body: AsyncIterable<string>;
}

export interface HttpClient {
	request(spec: HttpRequestSpec, signal?: AbortSignal): Promise<HttpResponse>;

	/**
	 * Open a streaming response.
	 *
	 * Returns `null` when streaming is unavailable in this environment (for
	 * example when the browser blocks the cross-origin request), so the caller
	 * can fall back to a buffered request instead of failing.
	 */
	openStream(
		spec: HttpRequestSpec,
		signal?: AbortSignal,
	): Promise<HttpStreamResponse | null>;
}

export function isOkStatus(status: number): boolean {
	return status >= 200 && status < 300;
}

/** Read a whole stream into a string, used for error bodies. */
export async function drainStream(body: AsyncIterable<string>): Promise<string> {
	let text = '';
	for await (const chunk of body) text += chunk;
	return text;
}
