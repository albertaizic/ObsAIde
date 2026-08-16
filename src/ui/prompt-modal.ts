import { Modal, Setting, type App } from 'obsidian';

export interface PromptModalOptions {
	title: string;
	description?: string;
	placeholder?: string;
	value?: string;
	submitText?: string;
	/** Render a textarea instead of a single-line field. */
	multiline?: boolean;
	onSubmit: (value: string) => void;
}

/** Small reusable "ask for one value" modal. */
export class PromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private readonly options: PromptModalOptions,
	) {
		super(app);
		this.value = options.value ?? '';
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('obsaide-prompt-modal');
		this.setTitle(this.options.title);

		if (this.options.description) {
			contentEl.createEl('p', {
				cls: 'obsaide-modal-description',
				text: this.options.description,
			});
		}

		const field = new Setting(contentEl);
		field.settingEl.addClass('obsaide-prompt-field');
		if (this.options.multiline) {
			field.addTextArea((textarea) => {
				textarea
					.setPlaceholder(this.options.placeholder ?? '')
					.setValue(this.value)
					.onChange((value) => {
						this.value = value;
					});
				textarea.inputEl.rows = 4;
				window.setTimeout(() => textarea.inputEl.focus(), 0);
			});
		} else {
			field.addText((text) => {
				text
					.setPlaceholder(this.options.placeholder ?? '')
					.setValue(this.value)
					.onChange((value) => {
						this.value = value;
					});
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});
		}

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(this.options.submitText ?? 'Submit')
				.setCta()
				.onClick(() => this.submit()),
		);
	}

	private submit(): void {
		const value = this.value;
		this.close();
		this.options.onSubmit(value);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
