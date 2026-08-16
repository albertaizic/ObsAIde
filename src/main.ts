import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { AIDE_ICON, ASSISTANT_NAME, CHAT_VIEW_TYPE } from './constants';
import { ChatController } from './chat/controller';
import { registerCommands, registerEditorMenu } from './commands';
import { createConversationStorage } from './chat/obsidian-storage';
import { ConversationStore } from './chat/store';
import { ObsidianHttpClient } from './providers/obsidian-http';
import { ProviderService } from './providers/service';
import { ObsAideSettingTab } from './settings/settings-tab';
import { createDefaultSettings, normalizeSettings, type ObsAideSettings } from './settings/types';
import { AideChatView } from './ui/chat-view';

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
	conversations!: ConversationStore;
	chat!: ChatController;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.providers = new ProviderService(() => this.settings, new ObsidianHttpClient());

		this.conversations = new ConversationStore(createConversationStorage(this), {
			isPersistenceEnabled: () => this.settings.persistConversations,
		});
		await this.conversations.load();

		this.chat = new ChatController({
			app: this.app,
			providers: this.providers,
			store: this.conversations,
			getSettings: () => this.settings,
			saveSettings: () => this.saveSettings(),
		});

		this.registerView(CHAT_VIEW_TYPE, (leaf) => new AideChatView(leaf, this));

		this.addRibbonIcon(AIDE_ICON, `Open ${ASSISTANT_NAME}`, () => {
			void this.activateChatView();
		});

		registerCommands(this);
		registerEditorMenu(this);

		this.addSettingTab(new ObsAideSettingTab(this.app, this));
	}

	override onunload(): void {
		this.chat?.stop();
		this.conversations?.dispose();
		// Obsidian does not await `onunload`; the final write is fired here and
		// is safe to lose only if the app is killed mid-write.
		void this.conversations?.flush();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Connection details may have changed; discovered models are no longer
		// guaranteed to match the configured endpoint.
		this.providers.invalidateModels();
	}

	/** Open the Aide sidebar, reusing the existing leaf when there is one. */
	async activateChatView(): Promise<AideChatView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		}

		await workspace.revealLeaf(leaf);
		const view = leaf.view;
		return view instanceof AideChatView ? view : null;
	}

	/** Jump straight to this plugin's settings tab. */
	openSettings(): void {
		const setting = (
			this.app as unknown as {
				setting?: { open(): void; openTabById(id: string): void };
			}
		).setting;
		if (!setting) {
			new Notice('Open the ObsAIde tab in Obsidian settings.');
			return;
		}
		setting.open();
		setting.openTabById(this.manifest.id);
	}
}
