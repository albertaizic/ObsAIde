/**
 * Short, collision-resistant identifier for conversations and messages.
 * Not security relevant: it only has to be unique inside one vault.
 */
export function createId(prefix = ''): string {
	const random = Math.random().toString(36).slice(2, 10);
	const time = Date.now().toString(36);
	return `${prefix}${time}${random}`;
}
