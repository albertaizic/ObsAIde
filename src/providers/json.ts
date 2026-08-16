/** Defensive accessors for provider payloads, which are never fully trusted. */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getRecord(value: unknown, key: string): JsonRecord | undefined {
	if (!isRecord(value)) return undefined;
	const child = value[key];
	return isRecord(child) ? child : undefined;
}

export function getArray(value: unknown, key: string): unknown[] {
	if (!isRecord(value)) return [];
	const child = value[key];
	return Array.isArray(child) ? child : [];
}

export function getString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const child = value[key];
	return typeof child === 'string' ? child : undefined;
}

export function getNumber(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) return undefined;
	const child = value[key];
	return typeof child === 'number' && Number.isFinite(child) ? child : undefined;
}

/** Parse JSON without throwing; returns `undefined` for anything unparsable. */
export function parseJson(text: string): unknown {
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
