import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { AIDE_ICON, ASSISTANT_NAME, CHAT_VIEW_TYPE } from './constants';
import { EditTargetRegistry } from './actions/edit-target';
import { ChatController } from './chat/controller';
import { registerCommands, registerEditorMenu } from './commands';
import { createConversationStorage } from './chat/obsidian-storage';
import { ConversationStore } from './chat/store';
import { ObsidianHttpClient } from './providers/obsidian-http';
import { ProviderService } from './providers/service';
import { ObsAideSettingTab } from './settings/settings-tab';
import {
	createDefaultSettings,
	needsMigration,
	normalizeSettings,
	type ObsAideSettings,
} from './settings/types';
import { ProfileRegistry, migrateTutorMode } from './settings/profiles';
import { AideChatView } from './ui/chat-view';
import { InlineAideMenu } from './ui/inline-menu';

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
	profiles!: ProfileRegistry;
	/** Runtime-only map from reply to the editor it was generated from. */
	readonly editTargets = new EditTargetRegistry();
	/** Inline menu for selected text. */
	inlineMenu!: InlineAideMenu;

	async onload(): Promise<void> {
		const stored: unknown = await this.loadData();
		this.settings = normalizeSettings(stored);
		// Values that were valid under an older schema — a temperature of 2, say
		// — are clamped on load, so persist the corrected settings immediately
		// rather than leaving the old value to be sent invisibly.
		if (needsMigration(stored, this.settings)) await this.saveData(this.settings);
		this.providers = new ProviderService(() => this.settings, new ObsidianHttpClient());

		this.profiles = new ProfileRegistry(
			() => this.settings,
			() => this.saveSettings(),
		);

		// Migrate old tutorModeByDefault to profile system
		const migration = migrateTutorMode(this.settings);
		if (migration.activeProfileId) {
			this.settings.activeProfileId = migration.activeProfileId;
			await this.saveSettings();
		}

		this.conversations = new ConversationStore(createConversationStorage(this), {
			isPersistenceEnabled: () => this.settings.persistConversations,
		});
		await this.conversations.load();

		this.chat = new ChatController({
			app: this.app,
			providers: this.providers,
			store: this.conversations,
			editTargets: this.editTargets,
			getSettings: () => this.settings,
			saveSettings: () => this.saveSettings(),
		});

		this.registerView(CHAT_VIEW_TYPE, (leaf) => new AideChatView(leaf, this));

		this.addRibbonIcon(AIDE_ICON, `Open ${ASSISTANT_NAME}`, () => {
			void this.activateChatView();
		});

		registerCommands(this);
		registerEditorMenu(this);

		// Inline selection menu
		this.inlineMenu = new InlineAideMenu(this);
		this.inlineMenu.enable();

		this.addSettingTab(new ObsAideSettingTab(this.app, this));
	}

	override onunload(): void {
		this.chat?.stop();
		this.inlineMenu?.disable();
		this.editTargets.clear();
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

	/** Jump straight to this plugin's settings tab, optionally to a section. */
	openSettings(section?: 'profiles'): void {
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
		if (section === 'profiles') {
			this.scrollToSettingsSection('.obsaide-profiles-section');
		}
	}

	/**
	 * Scroll a settings section into view once the tab has rendered.
	 *
	 * A bounded requestAnimationFrame loop avoids both arbitrary delays and
	 * missing the element when Obsidian builds the settings DOM a frame or two
	 * after `open()`. Works whether or not Settings was already open.
	 */
	private scrollToSettingsSection(selector: string): void {
		// Obsidian mounts the Settings dialog on document.body as a sibling of
		// workspace.containerEl — searching the workspace never finds it.
		const container = document.body;
		let frames = 0;
		const look = (): void => {
			const target = container.querySelector<HTMLElement>(selector);
			if (target) {
				target.scrollIntoView({ block: 'start', behavior: 'smooth' });
				target.classList.remove('obsaide-settings-flash');
				// Restart the highlight even if the class was already present.
				void target.offsetWidth;
				target.classList.add('obsaide-settings-flash');
				target.addEventListener(
					'animationend',
					() => target.classList.remove('obsaide-settings-flash'),
					{ once: true },
				);
				return;
			}
			if (frames++ < 120) window.requestAnimationFrame(look);
		};
		window.requestAnimationFrame(look);
	}
}
