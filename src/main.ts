import { Plugin } from 'obsidian';
import { ObsidianHttpClient } from './providers/obsidian-http';
import { ProviderService } from './providers/service';
import { createDefaultSettings, normalizeSettings, type ObsAideSettings } from './settings/types';

/**
 * ObsAIde plugin entry point.
 *
 * Keep this file limited to lifecycle and registration; feature logic lives in
 * the `providers/`, `chat/`, `context/`, `actions/`, `ui/` and `settings/`
 * modules.
 */
export default class ObsAidePlugin extends Plugin {
	settings: ObsAideSettings = createDefaultSettings();
	providers!: ProviderService;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.providers = new ProviderService(() => this.settings, new ObsidianHttpClient());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Connection details may have changed; discovered models are no longer
		// guaranteed to match the configured endpoint.
		this.providers.invalidateModels();
	}
}
