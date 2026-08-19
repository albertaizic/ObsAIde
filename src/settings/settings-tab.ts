import { Modal, Notice, PluginSettingTab, Setting, setIcon, type App } from 'obsidian';
import { ASSISTANT_NAME } from '../constants';
import type ObsAidePlugin from '../main';
import { getProviderDescriptor, listProviderDescriptors } from '../providers/catalog';
import { AideError } from '../providers/errors';
import type { ProviderId } from '../providers/types';
import { ModelPickerModal } from '../ui/model-picker';
import {
	CONTEXT_CHAR_RANGE,
	MAX_OUTPUT_TOKENS_RANGE,
	TEMPERATURE_RANGE,
	isProviderConfigured,
	providerLabel,
	type CustomAction,
	type CustomActionContextMode,
	type CustomActionOutputMode,
} from './types';

/** The ObsAIde settings tab. */
export class ObsAideSettingTab extends PluginSettingTab {
	private testAbort: AbortController | null = null;

	constructor(
		app: App,
		private readonly plugin: ObsAidePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('obsaide-settings');

		this.renderGeneral(containerEl);
		this.renderResponseLength(containerEl);
		this.renderCustomActions(containerEl);
		this.renderProviders(containerEl);
		this.renderContext(containerEl);
		this.renderPrivacy(containerEl);
	}

	override hide(): void {
		this.testAbort?.abort();
		this.testAbort = null;
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	// --- general -------------------------------------------------------------

	private renderGeneral(container: HTMLElement): void {
		const settings = this.plugin.settings;

		new Setting(container).setName(ASSISTANT_NAME).setHeading();

		new Setting(container)
			.setName('Default provider')
			.setDesc('Used for new requests. You can switch provider from the Aide sidebar.')
			.addDropdown((dropdown) => {
				for (const descriptor of listProviderDescriptors()) {
					dropdown.addOption(
						descriptor.id,
						providerLabel(settings, descriptor.id),
					);
				}
				dropdown.setValue(settings.defaultProvider).onChange(async (value) => {
					settings.defaultProvider = value as ProviderId;
					await this.save();
					this.display();
				});
			});

		new Setting(container)
			.setName('Custom instructions')
			.setDesc(
				`Added to ${ASSISTANT_NAME}'s system prompt on every request. Useful for tone, language or subject focus.`,
			)
			.addTextArea((textarea) => {
				textarea
					.setPlaceholder('Prefer short paragraphs and concrete examples.')
					.setValue(settings.customInstructions)
					.onChange(async (value) => {
						settings.customInstructions = value;
						await this.save();
					});
				textarea.inputEl.rows = 4;
				textarea.inputEl.addClass('obsaide-settings-textarea');
			});

		new Setting(container)
			.setName('Start conversations in tutor mode')
			.setDesc('Tutor mode explains and checks understanding instead of giving finished answers.')
			.addToggle((toggle) =>
				toggle.setValue(settings.tutorModeByDefault).onChange(async (value) => {
					settings.tutorModeByDefault = value;
					await this.save();
				}),
			);

		new Setting(container)
			.setName('Stream responses')
			.setDesc(
				'Show replies as they are generated. ObsAIde falls back to a single response when streaming is not available.',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.streaming).onChange(async (value) => {
					settings.streaming = value;
					await this.save();
				}),
			);

		const temperature = new Setting(container)
			.setName('Temperature / creativity')
			.setDesc(
				'Lower is more focused and predictable; higher is more varied. Models that do not accept this setting simply do not receive it.',
			);
		const temperatureValue = temperature.controlEl.createSpan({
			cls: 'obsaide-slider-value',
			text: settings.temperature.toFixed(2),
		});
		temperature.addSlider((slider) =>
			slider
				.setLimits(TEMPERATURE_RANGE.min, TEMPERATURE_RANGE.max, TEMPERATURE_RANGE.step)
				.setValue(settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					settings.temperature = value;
					temperatureValue.setText(value.toFixed(2));
					await this.save();
				}),
		);

		new Setting(container)
			.setName('Maximum response length')
			.setDesc(
				`A cap, not a target: length is governed by the prompt. Between ${MAX_OUTPUT_TOKENS_RANGE.min} and ${MAX_OUTPUT_TOKENS_RANGE.max} tokens.`,
			)
			.addText((text) =>
				text
					.setValue(String(settings.maxOutputTokens))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (!Number.isFinite(parsed)) return;
						settings.maxOutputTokens = Math.min(
							MAX_OUTPUT_TOKENS_RANGE.max,
							Math.max(MAX_OUTPUT_TOKENS_RANGE.min, parsed),
						);
						await this.save();
					}),
			);
	}

	// --- providers -----------------------------------------------------------

	private renderProviders(container: HTMLElement): void {
		new Setting(container).setName('Providers').setHeading();

		container.createEl('p', {
			cls: 'setting-item-description obsaide-settings-note',
			text: 'API keys are stored locally in this plugin’s data file and are only ever sent to the provider they belong to.',
		});

		for (const descriptor of listProviderDescriptors()) {
			this.renderProvider(container, descriptor.id);
		}
	}

	private renderProvider(container: HTMLElement, id: ProviderId): void {
		const settings = this.plugin.settings;
		const descriptor = getProviderDescriptor(id);
		const provider = settings.providers[id];

		const details = container.createEl('details', { cls: 'obsaide-provider' });
		details.open = id === settings.defaultProvider;

		const summary = details.createEl('summary', { cls: 'obsaide-provider-summary' });
		summary.createSpan({
			cls: 'obsaide-provider-name',
			text: providerLabel(settings, id),
		});
		const status = summary.createSpan({ cls: 'obsaide-provider-status' });
		const configured = isProviderConfigured(settings, id);
		status.setText(configured ? 'Ready' : 'Not configured');
		status.toggleClass('is-ready', configured);
		if (!provider.enabled) {
			summary.createSpan({ cls: 'obsaide-provider-status', text: 'Disabled' });
		}

		const body = details.createDiv({ cls: 'obsaide-provider-body' });
		body.createEl('p', {
			cls: 'setting-item-description',
			text: descriptor.summary,
		});

		new Setting(body)
			.setName('Enabled')
			.setDesc('Show this provider in the Aide sidebar picker.')
			.addToggle((toggle) =>
				toggle.setValue(provider.enabled).onChange(async (value) => {
					provider.enabled = value;
					await this.save();
				}),
			);

		if (id === 'custom') {
			new Setting(body)
				.setName('Display name')
				.setDesc('Shown wherever ObsAIde names this provider.')
				.addText((text) =>
					text
						.setPlaceholder('Custom')
						.setValue(settings.customProviderLabel)
						.onChange(async (value) => {
							settings.customProviderLabel = value.trim() || 'Custom';
							await this.save();
						}),
				);
		}

		if (descriptor.requiresApiKey || id === 'custom') {
			const keySetting = new Setting(body)
				.setName('API key')
				.setDesc(
					descriptor.apiKeyUrl
						? `Stored locally. Get a key at ${descriptor.apiKeyUrl}`
						: 'Stored locally. Leave empty if the endpoint needs no key.',
				);
			keySetting.addText((text) => {
				text
					.setPlaceholder(descriptor.requiresApiKey ? 'Required' : 'Optional')
					.setValue(provider.apiKey)
					.onChange(async (value) => {
						provider.apiKey = value.trim();
						await this.save();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.inputEl.addClass('obsaide-key-input');

				keySetting.addExtraButton((button) =>
					button
						.setIcon('eye')
						.setTooltip('Show or hide the key')
						.onClick(() => {
							const hidden = text.inputEl.type === 'password';
							text.inputEl.type = hidden ? 'text' : 'password';
							button.setIcon(hidden ? 'eye-off' : 'eye');
						}),
				);
			});
		}

		if (descriptor.baseUrlEditable) {
			new Setting(body)
				.setName('Base URL')
				.setDesc(
					descriptor.defaultBaseUrl
						? `Leave empty to use ${descriptor.defaultBaseUrl}`
						: 'Required. For example http://localhost:11434/v1',
				)
				.addText((text) =>
					text
						.setPlaceholder(descriptor.defaultBaseUrl || 'https://…/v1')
						.setValue(provider.baseUrl)
						.onChange(async (value) => {
							provider.baseUrl = value.trim();
							await this.save();
						}),
				);
		}

		const modelSetting = new Setting(body)
			.setName('Model')
			.setDesc(provider.model || 'No model selected.');
		modelSetting.addButton((button) =>
			button.setButtonText('Choose model').onClick(() => {
				new ModelPickerModal(
					this.app,
					this.plugin.providers,
					id,
					provider.model,
					(model) => {
						provider.model = model;
						void this.save().then(() => this.display());
					},
				).open();
			}),
		);
		modelSetting.addExtraButton((button) =>
			button
				.setIcon('refresh-cw')
				.setTooltip('Refresh the model list')
				.onClick(() => {
					this.plugin.providers.invalidateModels(id);
					new Notice('Model list will be refreshed.');
				}),
		);

		this.renderTestConnection(body, id);
	}

	private renderTestConnection(parent: HTMLElement, id: ProviderId): void {
		const result = parent.createDiv({ cls: 'obsaide-test-result' });

		new Setting(parent)
			.setName('Test connection')
			.setDesc('Sends one very small request to check the key, endpoint and model.')
			.addButton((button) =>
				button.setButtonText('Test').onClick(() => {
					void (async () => {
						this.testAbort?.abort();
						const controller = new AbortController();
						this.testAbort = controller;

						button.setDisabled(true);
						this.setTestResult(result, 'pending', 'Testing…');
						try {
							const message = await this.plugin.providers.testConnection(
								id,
								controller.signal,
							);
							this.setTestResult(result, 'ok', message);
						} catch (error) {
							const message =
								error instanceof AideError
									? error.message
									: 'The test failed for an unknown reason.';
							this.setTestResult(result, 'error', message);
						} finally {
							button.setDisabled(false);
							if (this.testAbort === controller) this.testAbort = null;
						}
					})();
				}),
			);

		// Keep the result underneath the button.
		parent.appendChild(result);
	}

	private setTestResult(
		el: HTMLElement,
		state: 'pending' | 'ok' | 'error',
		message: string,
	): void {
		el.empty();
		el.removeClass('is-ok', 'is-error', 'is-pending');
		el.addClass(`is-${state}`);
		const icon = el.createSpan({ cls: 'obsaide-test-icon' });
		setIcon(icon, state === 'ok' ? 'check' : state === 'error' ? 'alert-triangle' : 'loader');
		el.createSpan({ text: message });
	}

	// --- context -------------------------------------------------------------

	private renderContext(container: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(container).setName('Note context').setHeading();

		container.createEl('p', {
			cls: 'setting-item-description obsaide-settings-note',
			text: 'Notes are only read when you attach them to a request. ObsAIde never indexes or uploads your vault.',
		});

		new Setting(container)
			.setName('Characters per note')
			.setDesc('Longer notes are truncated before being sent.')
			.addText((text) =>
				text.setValue(String(settings.maxCharsPerNote)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					settings.maxCharsPerNote = clamp(parsed);
					await this.save();
				}),
			);

		new Setting(container)
			.setName('Characters per request')
			.setDesc('Total budget across every attachment in one message.')
			.addText((text) =>
				text.setValue(String(settings.maxContextChars)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					settings.maxContextChars = clamp(parsed);
					await this.save();
				}),
			);
	}

	// --- privacy -------------------------------------------------------------

	private renderPrivacy(container: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(container).setName('Privacy').setHeading();

		container.createEl('p', {
			cls: 'setting-item-description obsaide-settings-note',
			text: 'Requests go directly from Obsidian to the provider you selected. ObsAIde has no backend, no telemetry and makes no other network requests. What the provider does with your data is governed by its own policy.',
		});

		new Setting(container)
			.setName('Save conversation history')
			.setDesc(
				'Keeps conversations in the plugin folder so they survive a restart. Turning this off deletes the stored history.',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.persistConversations).onChange(async (value) => {
					settings.persistConversations = value;
					await this.save();
					await this.plugin.conversations.flush();
				}),
			);

		new Setting(container)
			.setName('Delete conversation history')
			.setDesc('Removes every conversation stored on this device.')
			.addButton((button) =>
				button
					.setButtonText('Delete')
					.setWarning()
					.onClick(() => {
						void (async () => {
							this.plugin.conversations.clear();
							await this.plugin.conversations.flush();
							this.plugin.chat.newConversation();
							new Notice('Conversation history deleted.');
						})();
					}),
			);
	}

	// --- response length -----------------------------------------------------

	private renderResponseLength(container: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(container).setName('Response length').setHeading();

		container.createEl('p', {
			cls: 'setting-item-description obsaide-settings-note',
			text: 'Controls how much detail Aide includes in its answers. This is a prompt-level instruction, not a hard token limit.',
		});

		new Setting(container)
			.setName('Default response length')
			.setDesc('Short = concise, direct answers. Normal = balanced. Detailed = more explanation and examples.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('short', 'Short')
					.addOption('normal', 'Normal')
					.addOption('detailed', 'Detailed')
					.setValue(settings.responseLength)
					.onChange(async (value) => {
						settings.responseLength = value as 'short' | 'normal' | 'detailed';
						await this.save();
					});
			});
	}

	// --- custom actions ------------------------------------------------------

	private renderCustomActions(container: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(container).setName('Custom actions').setHeading();

		container.createEl('p', {
			cls: 'setting-item-description obsaide-settings-note',
			text: 'Create reusable AI actions that appear in the editor context menu and inline selection menu. Built-in actions cannot be deleted.',
		});

		// Add action button
		new Setting(container)
			.setName('Add custom action')
			.addButton((button) =>
				button
					.setButtonText('Create new action')
					.setCta()
					.onClick(() => this.openCustomActionModal(null)),
			);

		// List existing custom actions
		if (settings.customActions.length === 0) {
			container.createEl('p', {
				cls: 'setting-item-description',
				text: 'No custom actions yet. Click "create new action" to add one.',
			});
			return;
		}

		const list = container.createDiv({ cls: 'obsaide-custom-actions-list' });
		for (const action of settings.customActions) {
			this.renderCustomActionItem(list, action);
		}
	}

	private renderCustomActionItem(container: HTMLElement, action: CustomAction): void {
		const item = container.createDiv({ cls: 'obsaide-custom-action-item' });

		const info = item.createDiv({ cls: 'obsaide-custom-action-info' });
		info.createDiv({ cls: 'obsaide-custom-action-name', text: action.name });
		info.createDiv({
			cls: 'obsaide-custom-action-meta',
			text: `Context: ${action.contextMode} · Output: ${action.outputMode} · ${action.enabled ? 'Enabled' : 'Disabled'}`,
		});

		const actions = item.createDiv({ cls: 'obsaide-custom-action-buttons' });
		actions.createEl('button', {
			cls: 'obsaide-button is-small',
			text: action.enabled ? 'Disable' : 'Enable',
		}).addEventListener('click', () => {
			action.enabled = !action.enabled;
			void this.save().then(() => this.display());
		});
		actions.createEl('button', {
			cls: 'obsaide-button is-small',
			text: 'Edit',
		}).addEventListener('click', () => this.openCustomActionModal(action));
		actions.createEl('button', {
			cls: 'obsaide-button is-small',
			text: 'Delete',
		}).addEventListener('click', () => {
			const idx = this.plugin.settings.customActions.indexOf(action);
			if (idx >= 0) {
				this.plugin.settings.customActions.splice(idx, 1);
				void this.save().then(() => this.display());
			}
		});
	}

	private openCustomActionModal(action: CustomAction | null): void {
		const isEditing = action !== null;
		const data = action ?? {
			id: '',
			name: '',
			icon: 'zap',
			instruction: '',
			contextMode: 'smart' as CustomActionContextMode,
			outputMode: 'answer' as CustomActionOutputMode,
			enabled: true,
		};

		const modal = new CustomActionModal(this.app, data, isEditing, (result) => {
			void (async () => {
				if (isEditing) {
					const idx = this.plugin.settings.customActions.findIndex((a) => a.id === action.id);
					if (idx >= 0) this.plugin.settings.customActions[idx] = result;
				} else {
					result.id = `custom-${Date.now()}`;
					this.plugin.settings.customActions.push(result);
				}
				await this.save();
				this.display();
			})();
		});
		modal.open();
	}
}

function clamp(value: number): number {
	return Math.min(CONTEXT_CHAR_RANGE.max, Math.max(CONTEXT_CHAR_RANGE.min, value));
}

/** Modal for creating/editing a custom action. */
class CustomActionModal extends Modal {
	private resolve: ((value: CustomAction) => void) | null = null;

	constructor(
		app: App,
		private readonly initialData: Partial<CustomAction>,
		private readonly isEditing: boolean,
		onSubmit: (action: CustomAction) => void,
	) {
		super(app);
		this.resolve = onSubmit;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-custom-action-modal');

		const data = this.initialData as CustomAction;

		new Setting(contentEl)
			.setName('Action name')
			.addText((text) =>
				text
					.setPlaceholder('E.g., make flashcards')
					.setValue(data.name)
					.onChange((value) => (data.name = value.trim())),
			);

		new Setting(contentEl)
			.setName('Icon')
			.setDesc('Obsidian icon name (e.g., zap, book-open, brain, pencil)')
			.addText((text) =>
				text
					.setPlaceholder('Zap')
					.setValue(data.icon || 'zap')
					.onChange((value) => (data.icon = value.trim() || 'zap')),
			);

		new Setting(contentEl)
			.setName('Instruction')
			.setDesc('The prompt sent to the AI. Use clear, specific instructions.')
			.addTextArea((textarea) => {
				textarea
					.setPlaceholder('Create flashcards from the selected text...')
					.setValue(data.instruction)
					.onChange((value) => (data.instruction = value.trim()));
				textarea.inputEl.rows = 4;
			});

		new Setting(contentEl)
			.setName('Context mode')
			.setDesc('What context to include with the request.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('smart', 'Smart/default (selection + containing note)')
					.addOption('selection', 'Selection only')
					.addOption('section', 'Current Markdown section')
					.addOption('note', 'Full current note')
					.setValue(data.contextMode)
					.onChange((value) => (data.contextMode = value as CustomActionContextMode));
			});

		new Setting(contentEl)
			.setName('Output mode')
			.setDesc('How to handle the AI response.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('answer', 'Answer (normal chat response)')
					.addOption('note-ready', 'Note-ready (content only, no conversational wrapping)')
					.addOption('rewrite', 'Rewrite/edit (uses review flow)')
					.setValue(data.outputMode)
					.onChange((value) => (data.outputMode = value as CustomActionOutputMode));
			});

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: this.isEditing ? 'Save' : 'Create',
		}).addEventListener('click', () => {
			if (!data.name.trim()) {
				new Notice('Please enter a name');
				return;
			}
			if (!data.instruction.trim()) {
				new Notice('Please enter an instruction');
				return;
			}
			this.resolve?.(data);
			this.close();
		});
		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => {
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
