import { redactSecrets } from '../utils/secrets';

/**
 * Every failure the user can see is funnelled into an {@link AideError} so the
 * UI can react to a small, stable set of causes instead of parsing strings.
 */
export type AideErrorKind =
	| 'not-configured'
	| 'missing-api-key'
	| 'authentication'
	| 'permission'
	| 'invalid-model'
	| 'invalid-request'
	| 'rate-limit'
	| 'quota'
	| 'network'
	| 'timeout'
	| 'aborted'
	| 'malformed-response'
	| 'empty-response'
	| 'stream-interrupted'
	| 'server'
	| 'unknown';

export interface AideErrorOptions {
	/** HTTP status, when the failure came from a response. */
	status?: number;
	/** Message reported by the provider, already redacted. */
	providerMessage?: string;
	cause?: unknown;
}

export class AideError extends Error {
	readonly kind: AideErrorKind;
	readonly status?: number;
	readonly providerMessage?: string;
	/** Declared here rather than via `Error`'s options for ES2021 targets. */
	readonly cause?: unknown;

	constructor(kind: AideErrorKind, message: string, options: AideErrorOptions = {}) {
		super(message);
		this.name = 'AideError';
		this.kind = kind;
		this.status = options.status;
		this.providerMessage = options.providerMessage;
		this.cause = options.cause;
	}

	/** True while the same request could plausibly succeed on a retry. */
	get retryable(): boolean {
		return (
			this.kind === 'network' ||
			this.kind === 'timeout' ||
			this.kind === 'rate-limit' ||
			this.kind === 'server' ||
			this.kind === 'stream-interrupted'
		);
	}
}

/** True when a rejection is the result of the user pressing stop. */
export function isAbortError(error: unknown): boolean {
	if (error instanceof AideError) return error.kind === 'aborted';
	if (typeof error !== 'object' || error === null) return false;
	const name = (error as { name?: unknown }).name;
	return name === 'AbortError';
}

const KEY_HINTS = /api[\s_-]?key|unauthor|authentication|invalid.*token|forbidden/i;
const MODEL_HINTS = /model/i;
const QUOTA_HINTS = /quota|credit|billing|balance|insufficient|payment|exceeded your current/i;

/**
 * Map an HTTP status plus the provider's own wording onto an error kind.
 * The wording is only used to disambiguate statuses that providers overload.
 */
export function classifyHttpFailure(
	status: number,
	providerMessage: string | undefined,
): AideErrorKind {
	const hint = providerMessage ?? '';
	if (status === 401) return 'authentication';
	if (status === 403) return KEY_HINTS.test(hint) ? 'authentication' : 'permission';
	if (status === 402) return 'quota';
	if (status === 429) return QUOTA_HINTS.test(hint) ? 'quota' : 'rate-limit';
	if (status === 404) return MODEL_HINTS.test(hint) ? 'invalid-model' : 'invalid-request';
	if (status === 408 || status === 504) return 'timeout';
	if (status === 400 || status === 422) {
		if (QUOTA_HINTS.test(hint)) return 'quota';
		if (MODEL_HINTS.test(hint)) return 'invalid-model';
		return 'invalid-request';
	}
	if (status >= 500) return 'server';
	if (status >= 400) return 'invalid-request';
	return 'unknown';
}

const KIND_HEADLINE: Record<AideErrorKind, string> = {
	'not-configured': 'This provider is not configured yet.',
	'missing-api-key': 'No API key is set for this provider.',
	authentication: 'The provider rejected the API key.',
	permission: 'The provider refused this request.',
	'invalid-model': 'The selected model is not available.',
	'invalid-request': 'The provider rejected the request.',
	'rate-limit': 'Rate limit reached. Wait a moment and try again.',
	quota: 'The provider reports insufficient quota or credit.',
	network: 'Could not reach the provider.',
	timeout: 'The provider took too long to respond.',
	aborted: 'Generation stopped.',
	'malformed-response': 'The provider returned a response ObsAIde could not read.',
	'empty-response': 'The provider returned an empty response.',
	'stream-interrupted': 'The response stream ended unexpectedly.',
	server: 'The provider reported a server error.',
	unknown: 'Something went wrong.',
};

/** Build the user-facing sentence for an error kind plus provider detail. */
export function buildErrorMessage(
	kind: AideErrorKind,
	providerMessage: string | undefined,
): string {
	const headline = KIND_HEADLINE[kind];
	const detail = providerMessage?.trim();
	if (!detail) return headline;
	return `${headline} ${detail}`;
}

/**
 * Turn any thrown value into an {@link AideError}, stripping secrets from the
 * message so keys can never surface in the UI or in a stack trace.
 */
export function toAideError(error: unknown, secrets: readonly string[] = []): AideError {
	if (error instanceof AideError) return error;
	if (isAbortError(error)) {
		return new AideError('aborted', KIND_HEADLINE.aborted);
	}
	const raw = error instanceof Error ? error.message : String(error);
	const message = redactSecrets(raw, secrets);
	// `fetch` reports every transport-level problem as a bare TypeError.
	const kind: AideErrorKind =
		error instanceof TypeError || /failed to fetch|network|ENOTFOUND|ECONN/i.test(message)
			? 'network'
			: 'unknown';
	return new AideError(kind, buildErrorMessage(kind, message), { cause: error });
}
