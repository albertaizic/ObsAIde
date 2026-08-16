import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

describe('SseParser', () => {
	it('emits one payload per event', () => {
		const parser = new SseParser();
		expect(parser.push('data: one\n\ndata: two\n\n')).toEqual(['one', 'two']);
	});

	it('joins multi-line data fields', () => {
		const parser = new SseParser();
		expect(parser.push('data: {"a":\ndata: 1}\n\n')).toEqual(['{"a":\n1}']);
	});

	it('handles payloads split across chunks', () => {
		const parser = new SseParser();
		expect(parser.push('data: hel')).toEqual([]);
		expect(parser.push('lo\n')).toEqual([]);
		expect(parser.push('\n')).toEqual(['hello']);
	});

	it('ignores comments and unknown fields', () => {
		const parser = new SseParser();
		expect(parser.push(': keep-alive\nevent: ping\nid: 7\ndata: x\n\n')).toEqual(['x']);
	});

	it('accepts CRLF line endings', () => {
		const parser = new SseParser();
		expect(parser.push('data: x\r\n\r\n')).toEqual(['x']);
	});

	it('flushes a trailing event with no blank line', () => {
		const parser = new SseParser();
		expect(parser.push('data: tail\n')).toEqual([]);
		expect(parser.flush()).toEqual(['tail']);
	});

	it('preserves a data field with no leading space', () => {
		const parser = new SseParser();
		expect(parser.push('data:[DONE]\n\n')).toEqual(['[DONE]']);
	});
});
