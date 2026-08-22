import { Modal, Notice, Setting, type App } from 'obsidian';
import { ASSISTANT_NAME } from '../constants';
import { validateExportInput, type ConversationExportMode as ExportMode } from '../chat/export';
import { FolderPickerModal } from './folder-picker';

// The canonical validator lives in chat/export.ts (importable without
// Obsidian); re-exported so modal consumers can find it here.
export { validateExportInput };
export type { ExportMode };

export interface ConversationExportResult {
	name: string;
	folder: string;
	mode: ExportMode;
}

export interface ConversationExportOptions {
	defaultName: string;
	defaultFolder: string;
	onExport: (result: ConversationExportResult) => void;
}

/**
 * Save-conversation-as-note modal.
 *
 * Everything the export needs — name, folder and what to include — is
 * decided in this one modal before "Export" is pressed. There is no second
 * question afterwards.
 */
export class ConversationExportModal extends Modal {
	private name: string;
	private folder: string;
	private mode: ExportMode | null = null;
	private exportButton: HTMLButtonElement | null = null;

	constructor(
		app: App,
		private readonly options: ConversationExportOptions,
	) {
		super(app);
		this.name = options.defaultName;
		this.folder = options.defaultFolder;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-export-modal');
		this.setTitle('Save conversation as note');

		new Setting(contentEl).setName('Name').addText((text) =>
			text
				.setValue(this.name)
				.onChange((value) => {
					this.name = value;
				}),
		);

		new Setting(contentEl)
			.setName('Folder')
			.setDesc('Where the new note is created.')
			.addText((text) => {
				text.setValue(this.folder).onChange((value) => {
					this.folder = value;
				});
				text.inputEl.addClass('obsaide-export-folder-input');
			})
			.addExtraButton((button) =>
				button
					.setIcon('folder')
					.setTooltip('Browse folders')
					.onClick(() => {
						new FolderPickerModal(this.app, (folder) => {
							this.folder = folder.path;
							this.onOpen();
						}).open();
					}),
			);

		new Setting(contentEl).setName('Include').setHeading();

		const options = contentEl.createDiv({ cls: 'obsaide-export-mode-options' });
		this.addModeOption(
			options,
			'questions-answers',
			'Questions + answers',
			'Exports the complete meaningful conversation.',
		);
		this.addModeOption(
			options,
			'answers-only',
			'Answers only',
			`Exports only ${ASSISTANT_NAME}'s useful responses.`,
		);

		const footer = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		footer
			.createEl('button', { cls: 'obsaide-button', text: 'Cancel' })
			.addEventListener('click', () => this.close());
		this.exportButton = footer.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Export',
		});
		this.exportButton.disabled = this.mode === null;
		this.exportButton.addEventListener('click', () => this.submit());
	}

	private addModeOption(
		container: HTMLElement,
		mode: ExportMode,
		label: string,
		description: string,
	): void {
		const option = container.createDiv({ cls: 'obsaide-export-mode-option' });
		option.toggleClass('is-selected', this.mode === mode);
		option.setAttribute('role', 'button');
		option.setAttribute('tabindex', '0');
		option.createDiv({ cls: 'obsaide-export-mode-title', text: label });
		option.createDiv({ cls: 'obsaide-export-mode-desc', text: description });
		const select = (): void => {
			this.mode = mode;
			this.onOpen();
		};
		option.addEventListener('click', select);
		option.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				select();
			}
		});
	}

	private submit(): void {
		const result = validateExportInput(this.name, this.folder, this.mode);
		if (!result.valid) {
			new Notice(result.reason === 'missing-name' ? 'Please enter a note name.' : 'Choose what to include first.');
			return;
		}
		this.close();
		this.options.onExport({ name: result.name, folder: result.folder, mode: result.mode });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
