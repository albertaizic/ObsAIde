import { Modal, Setting, Notice, type App, type TFolder } from 'obsidian';
import { FolderPickerModal } from './folder-picker';
import type { Attachment } from '../context/types';

/** Options for generating a quiz note. */
export interface QuizNoteOptions {
	/** Number of questions to generate. */
	questionCount: number;
	/** Difficulty level. */
	difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
	/** Question type. */
	type: 'short-answer' | 'multiple-choice' | 'mixed';
	/** Whether to include an answer key. */
	includeAnswerKey: boolean;
	/** Name for the quiz note (without .md extension). */
	name: string;
	/** Destination folder path. */
	folderPath: string;
	/** Context attachments to base the quiz on. */
	attachments: Attachment[];
}

/** Modal for configuring and creating a quiz note. */
export class QuizNoteModal extends Modal {
	private readonly onSubmit: (options: QuizNoteOptions) => void;
	private readonly attachments: Attachment[];
	private folderPath = '';
	private folderName = '';
	private name = '';
	private folderButton!: HTMLButtonElement;

	constructor(
		app: App,
		attachments: Attachment[],
		onSubmit: (options: QuizNoteOptions) => void,
	) {
		super(app);
		this.attachments = attachments;
		this.onSubmit = onSubmit;
		// Default to active file's folder or vault root
		const activeFile = app.workspace.getActiveFile();
		const defaultFolder = activeFile?.parent ?? app.vault.getRoot();
		this.folderPath = defaultFolder.path;
		this.folderName = defaultFolder.path === '' ? '/' : defaultFolder.path;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-quiz-note-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'obsaide-quiz-note-header' });
		header.createEl('h3', { text: 'Create quiz note' });

		// Number of questions
		new Setting(contentEl)
			.setName('Questions')
			.setDesc('How many questions should the quiz have?')
			.addDropdown((dropdown) => {
				for (const [value, label] of [
					['5', '5'],
					['10', '10'],
					['15', '15'],
					['20', '20'],
				] as const) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue('10');
				dropdown.onChange((value) => {
					this.questionCount = Number.parseInt(value, 10);
				});
			});

		// Difficulty
		new Setting(contentEl)
			.setName('Difficulty')
			.setDesc('What level of questions should be generated?')
			.addDropdown((dropdown) => {
				for (const [value, label] of [
					['easy', 'Easy'],
					['medium', 'Medium'],
					['hard', 'Hard'],
					['mixed', 'Mixed'],
				] as const) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue('mixed');
				dropdown.onChange((value) => {
					this.difficulty = value as QuizNoteOptions['difficulty'];
				});
			});

		// Type
		new Setting(contentEl)
			.setName('Type')
			.setDesc('What question format?')
			.addDropdown((dropdown) => {
				for (const [value, label] of [
					['short-answer', 'Short answer'],
					['multiple-choice', 'Multiple choice'],
					['mixed', 'Mixed'],
				] as const) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue('mixed');
				dropdown.onChange((value) => {
					this.type = value as QuizNoteOptions['type'];
				});
			});

		// Include answer key
		new Setting(contentEl)
			.setName('Include answer key')
			.setDesc('Append an answer key section at the end of the note.')
			.addToggle((toggle) => {
				toggle.setValue(true);
				toggle.onChange((value) => {
					this.includeAnswerKey = value;
				});
			});

		// Note name
		new Setting(contentEl)
			.setName('Name')
			.setDesc('Name for the quiz note (without .md extension)')
			.addText((text) => {
				text.setPlaceholder('Binary search quiz');
				text.onChange((value) => {
					this.name = value.trim();
				});
			});

		// Folder picker
		const folderSetting = new Setting(contentEl)
			.setName('Folder')
			.setDesc('Destination folder for the quiz note');

		this.folderButton = folderSetting.controlEl.createEl('button', {
			cls: 'obsaide-button',
			text: this.folderName || 'Choose folder…',
		});
		this.folderButton.addEventListener('click', () => this.openFolderPicker());

		// Context preview
		if (this.attachments.length > 0) {
			const contextInfo = contentEl.createDiv({ cls: 'obsaide-quiz-note-context' });
			contextInfo.createEl('p', {
				cls: 'setting-item-description',
				text: `Using ${this.attachments.length} attachment${this.attachments.length === 1 ? '' : 's'} as context`,
			});
		}

		// Buttons
		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const createButton = buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Create quiz note',
		});
		createButton.addEventListener('click', () => this.handleCreate());

		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => this.close());
	}

	private questionCount = 10;
	private difficulty: QuizNoteOptions['difficulty'] = 'mixed';
	private type: QuizNoteOptions['type'] = 'mixed';
	private includeAnswerKey = true;

	private openFolderPicker(): void {
		new FolderPickerModal(this.app, (folder: TFolder) => {
			this.folderPath = folder.path;
			this.folderName = folder.path === '' ? '/' : folder.path;
			this.folderButton.setText(this.folderName);
		}).open();
	}

	private handleCreate(): void {
		if (!this.name) {
			new Notice('Please enter a name for the quiz note.');
			return;
		}
		if (this.attachments.length === 0) {
			new Notice('Add some note context before creating a quiz.');
			return;
		}

		const options: QuizNoteOptions = {
			questionCount: this.questionCount,
			difficulty: this.difficulty,
			type: this.type,
			includeAnswerKey: this.includeAnswerKey,
			name: this.name,
			folderPath: this.folderPath,
			attachments: this.attachments,
		};

		this.close();
		this.onSubmit(options);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}