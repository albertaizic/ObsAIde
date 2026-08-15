import { Plugin } from 'obsidian';

/**
 * ObsAIde plugin entry point.
 *
 * Keep this file limited to lifecycle and registration; feature logic lives in
 * the `providers/`, `chat/`, `context/`, `actions/`, `ui/` and `settings/`
 * modules.
 */
export default class ObsAidePlugin extends Plugin {
	async onload(): Promise<void> {
		await Promise.resolve();
	}
}
