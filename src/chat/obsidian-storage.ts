import { normalizePath, type Plugin } from 'obsidian';
import { CONVERSATIONS_FILE } from '../constants';
import type { ConversationStorage } from './store';

/**
 * Conversations live next to the plugin's own settings, inside the plugin
 * folder. Nothing is ever written into the user's notes unless they explicitly
 * export a reply.
 */
export function createConversationStorage(plugin: Plugin): ConversationStorage {
	const adapter = plugin.app.vault.adapter;
	const directory = plugin.manifest.dir ?? '';
	const path = normalizePath(`${directory}/${CONVERSATIONS_FILE}`);

	return {
		async read(): Promise<unknown> {
			if (!(await adapter.exists(path))) return undefined;
			const raw = await adapter.read(path);
			return JSON.parse(raw) as unknown;
		},
		async write(data: unknown): Promise<void> {
			await adapter.write(path, JSON.stringify(data));
		},
		async remove(): Promise<void> {
			if (await adapter.exists(path)) await adapter.remove(path);
		},
	};
}
