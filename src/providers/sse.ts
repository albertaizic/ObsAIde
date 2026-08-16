/**
 * Incremental Server-Sent Events parser.
 *
 * Kept deliberately small: ObsAIde only needs the `data:` payloads, and every
 * supported provider carries its event type inside the JSON payload itself.
 */
export class SseParser {
	private buffer = '';
	private dataLines: string[] = [];

	/** Feed a decoded chunk; returns every complete `data:` payload it held. */
	push(chunk: string): string[] {
		this.buffer += chunk;
		const payloads: string[] = [];

		let newlineIndex = this.buffer.indexOf('\n');
		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
			this.buffer = this.buffer.slice(newlineIndex + 1);
			const payload = this.consumeLine(line);
			if (payload !== null) payloads.push(payload);
			newlineIndex = this.buffer.indexOf('\n');
		}

		return payloads;
	}

	/** Flush a trailing event that arrived without a final blank line. */
	flush(): string[] {
		const payloads: string[] = [];
		if (this.buffer) {
			const payload = this.consumeLine(this.buffer.replace(/\r$/, ''));
			if (payload !== null) payloads.push(payload);
			this.buffer = '';
		}
		const trailing = this.finishEvent();
		if (trailing !== null) payloads.push(trailing);
		return payloads;
	}

	private consumeLine(line: string): string | null {
		if (line === '') return this.finishEvent();
		// Comments (`: keep-alive`) and fields we do not use are ignored.
		if (line.startsWith(':')) return null;

		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		if (field !== 'data') return null;

		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		this.dataLines.push(value);
		return null;
	}

	private finishEvent(): string | null {
		if (this.dataLines.length === 0) return null;
		const payload = this.dataLines.join('\n');
		this.dataLines = [];
		return payload;
	}
}

/**
 * Some providers stream a bare JSON array instead of SSE when `alt=sse` is not
 * honoured. Detecting that early gives a clearer error than a JSON parse crash.
 */
export function looksLikeJsonArray(text: string): boolean {
	return text.trimStart().startsWith('[');
}
