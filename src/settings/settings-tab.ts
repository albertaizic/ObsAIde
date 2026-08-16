import { Notice, PluginSettingTab, Setting, setIcon, type App } from 'obsidian';
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
}

function clamp(value: number): number {
	return Math.min(CONTEXT_CHAR_RANGE.max, Math.max(CONTEXT_CHAR_RANGE.min, value));
}
