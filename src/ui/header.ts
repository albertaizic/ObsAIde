import { Menu, setIcon, setTooltip } from 'obsidian';
import { conversationTitle } from '../chat/conversation';
import type { ChatController } from '../chat/controller';
import { ASSISTANT_NAME } from '../constants';
import type ObsAidePlugin from '../main';
import { resolveEffectiveSettings, type EffectiveSettings } from '../settings/profiles';
import { isProviderConfigured } from '../settings/types';
import { summarize } from '../utils/text';

/**
 * Actions the header cannot own itself — they belong to flows and state that
 * live in the view (pickers, quiz/wikilink setup, exports, attachments).
 */
export interface HeaderCallbacks {
	/** Show the recent-conversations picker. */
	onOpenHistory(): void;
	/** Open quiz-note setup over the currently attached context. */
	onOpenQuizSetup(): void;
	/** Whether any context is attached (quiz needs some). */
	canCreateQuiz(): boolean;
	/** Open the wikilink suggestion workflow. */
	onOpenWikilinkSuggestions(): void;
	/** Export the conversation that is on screen right now. */
	onExportConversation(): void;
}

/**
 * The sidebar header: assistant title row (new/history/overflow), the live
 * conversation title, and the runtime row — profile, provider and model
 * selectors plus the tutor badge.
 *
 * Pure presentation and menus; every effectful decision is delegated to the
 * controller or the view through `HeaderCallbacks`.
 */
export class AideHeader {
	private conversationTitleEl!: HTMLElement;
	private profileButton!: HTMLButtonElement;
	private providerButton!: HTMLButtonElement;
	private modelButton!: HTMLButtonElement;
	private modeBadge!: HTMLElement;

	constructor(
		root: HTMLElement,
		private readonly plugin: ObsAidePlugin,
		private readonly controller: ChatController,
		private readonly callbacks: HeaderCallbacks,
	) {
		this.build(root);
	}

	/** What a turn would actually use right now (profile overrides applied). */
	getEffective(): EffectiveSettings {
		const settings = this.controller.getSettings();
		const profile = this.plugin.profiles.get(this.controller.current.activeProfileId ?? '');
		return resolveEffectiveSettings(profile, settings);
	}

	/** Refresh every widget from current controller/plugin state. */
	update(): void {
		const effective = this.getEffective();
		const configured = isProviderConfigured(this.controller.getSettings(), effective.providerId);
		const label = this.plugin.providers.label(effective.providerId);
		const model = effective.model || 'Choose a model';

		const conversation = this.controller.current;
		const title = conversationTitle(conversation);
		this.conversationTitleEl.setText(title || 'New conversation');
		this.conversationTitleEl.toggleClass('is-empty', !title);

		this.updateProfileButton();

		this.providerButton.setText(label);
		setTooltip(this.providerButton, `Provider: ${label}. Click to change.`);
		this.providerButton.toggleClass('is-unconfigured', !configured);

		const modelShort = summarize(model, 20);
		this.modelButton.setText(modelShort);
		setTooltip(this.modelButton, `Model: ${model}. Click to change.`);
		this.modelButton.toggleClass('is-unconfigured', !configured);

		this.modeBadge.toggleClass('is-visible', conversation.mode === 'tutor');
	}

	private build(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'obsaide-header' });

		// Row 1: Title + primary actions
		const titleRow = header.createDiv({ cls: 'obsaide-header-title-row' });
		titleRow.createEl('h2', { cls: 'obsaide-header-title', text: ASSISTANT_NAME });

		const titleActions = titleRow.createDiv({ cls: 'obsaide-header-title-actions' });

		const newChat = titleActions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'New conversation' },
		});
		setIcon(newChat, 'plus');
		setTooltip(newChat, 'New conversation');
		newChat.addEventListener('click', () => this.controller.newConversation());

		const historyBtn = titleActions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'Recent conversations' },
		});
		setIcon(historyBtn, 'history');
		setTooltip(historyBtn, 'Recent conversations');
		historyBtn.addEventListener('click', () => this.callbacks.onOpenHistory());

		const more = titleActions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'More options' },
		});
		setIcon(more, 'more-vertical');
		setTooltip(more, 'More options');
		more.addEventListener('click', (event) => this.showOverflowMenu(event));

		// Conversation title (shows when not empty)
		this.conversationTitleEl = header.createDiv({ cls: 'obsaide-conversation-title' });
		this.conversationTitleEl.setAttribute('aria-live', 'polite');

		// Row 2: Profile + Provider + Model
		const runtimeRow = header.createDiv({ cls: 'obsaide-header-runtime' });

		this.profileButton = runtimeRow.createEl('button', { cls: 'obsaide-select is-profile' });
		this.profileButton.addEventListener('click', () => this.showProfileMenu());

		this.providerButton = runtimeRow.createEl('button', { cls: 'obsaide-select is-provider' });
		this.providerButton.addEventListener('click', () => this.showProviderMenu());

		this.modelButton = runtimeRow.createEl('button', { cls: 'obsaide-select is-model' });
		this.modelButton.addEventListener('click', () => { void this.showModelMenu(); });

		this.modeBadge = runtimeRow.createSpan({ cls: 'obsaide-mode-badge', text: 'Tutor' });
	}

	private updateProfileButton(): void {
		const activeProfile = this.plugin.profiles.getActive();
		this.profileButton.setText(activeProfile.name);
		setTooltip(this.profileButton, `Profile: ${activeProfile.name}. Click to change.`);
	}

	private showProfileMenu(): void {
		const menu = new Menu();
		const profiles = this.plugin.profiles.getEnabled();

		for (const profile of profiles) {
			menu.addItem((item) =>
				item
					.setTitle(profile.name)
					.setIcon(profile.icon)
					.setChecked(profile.id === this.plugin.profiles.getActive().id)
					.onClick(async () => {
						await this.plugin.profiles.setActive(profile.id);
						// The switch also applies to the open conversation, not
						// just to conversations created from now on.
						this.controller.setConversationProfile(profile.id);
					}),
			);
		}

		const rect = this.profileButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private showProviderMenu(): void {
		const menu = new Menu();
		const settings = this.plugin.settings;
		const available = this.plugin.providers.availableProviders();

		if (available.length === 0) {
			menu.addItem((item) => item.setTitle('No providers enabled').setDisabled(true));
		} else {
			for (const id of available) {
				const configured = isProviderConfigured(settings, id);
				menu.addItem((item) =>
					item
						.setTitle(
							configured
								? this.plugin.providers.label(id)
								: `${this.plugin.providers.label(id)} — not configured`,
						)
						.setChecked(id === settings.defaultProvider)
						.onClick(() => void this.controller.setProvider(id)),
				);
			}
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Configure providers…')
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);

		const rect = this.providerButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private async showModelMenu(): Promise<void> {
		const menu = new Menu();
		const providerId = this.controller.providerId;
		const currentModel = this.controller.model;

		const modelInfos = await this.plugin.providers.listModels(providerId);
		const models = modelInfos.map(m => m.id);

		if (models.length === 0) {
			menu.addItem((item) => item.setTitle('No models available').setDisabled(true));
		} else {
			for (const model of models) {
				menu.addItem((item) =>
					item
						.setTitle(model)
						.setChecked(model === currentModel)
						.onClick(() => void this.controller.setModel(model)),
				);
			}
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Configure providers…')
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);

		const rect = this.modelButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private showOverflowMenu(event: MouseEvent): void {
		const menu = new Menu();
		const conversation = this.controller.current;

		menu.addItem((item) =>
			item
				.setTitle('New conversation')
				.setIcon('plus')
				.onClick(() => this.controller.newConversation()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Recent conversations…')
				.setIcon('history')
				.onClick(() => this.callbacks.onOpenHistory()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Tutor mode')
				.setIcon('graduation-cap')
				.setChecked(conversation.mode === 'tutor')
				.onClick(() =>
					this.controller.setMode(conversation.mode === 'tutor' ? 'chat' : 'tutor'),
				),
		);
		menu.addItem((item) =>
			item
				.setTitle('Create quiz note…')
				.setIcon('help-circle')
				.setDisabled(this.controller.isGenerating || !this.callbacks.canCreateQuiz())
				.onClick(() => this.callbacks.onOpenQuizSetup()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Suggest wikilinks…')
				.setIcon('link-2')
				.setDisabled(this.controller.isGenerating)
				.onClick(() => this.callbacks.onOpenWikilinkSuggestions()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Save conversation as note…')
				.setIcon('file-down')
				.onClick(() => this.callbacks.onExportConversation()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Clear conversation')
				.setIcon('eraser')
				.onClick(() => this.controller.clearConversation()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Delete conversation')
				.setIcon('trash')
				.onClick(() => this.controller.deleteConversation(conversation.id)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('ObsAIde settings')
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);
		menu.showAtMouseEvent(event);
	}
}
