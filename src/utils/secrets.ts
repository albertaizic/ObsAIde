/**
 * Helpers that keep API keys out of anything the user or a log can see.
 *
 * The plugin never logs keys, but provider error bodies and stack traces are
 * outside our control, so every string that reaches the UI is passed through
 * `redactSecrets` first.
 */

const MIN_SECRET_LENGTH = 8;

/** Replace any occurrence of a known secret with a placeholder. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
	let output = text;
	for (const secret of secrets) {
		if (!secret || secret.length < MIN_SECRET_LENGTH) continue;
		output = output.split(secret).join('[redacted]');
	}
	return output;
}

/** Render a key for display, e.g. `sk-or…9f2c`. Never shows the middle. */
export function maskSecret(secret: string): string {
	if (!secret) return '';
	if (secret.length <= MIN_SECRET_LENGTH) return '••••';
	return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
