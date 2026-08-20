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
	type: 'short-answer' | 'multiple-choice' | 'true-false' | 'explain' | 'application' | 'mixed';
	/** Whether to include an answer key. */
	includeAnswerKey: boolean;
	/** Name for the quiz note (without .md extension). */
	name: string;
	/** Destination folder path. */
	folderPath: string;
	/** Context attachments to base the quiz on. */
	attachments: Attachment[];
	/** Whether the modal is in loading state. */
	isLoading?: boolean;
}

/** Modal for configuring and creating a quiz note. */
export class QuizNoteModal extends Modal {
	private readonly onSubmit: (options: QuizNoteOptions) => void | Promise<void>;
	private readonly attachments: Attachment[];
	private folderPath = '';
	private folderName = '';
	private name = '';
	private folderButton!: HTMLButtonElement;
	private createButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private isLoading = false;

	constructor(
		app: App,
		attachments: Attachment[],
		onSubmit: (options: QuizNoteOptions) => void | Promise<void>,
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

		// Context section
		if (this.attachments.length > 0) {
			const contextSection = contentEl.createDiv({ cls: 'obsaide-quiz-note-section' });
			new Setting(contextSection)
				.setName('Context')
				.setDesc(`${this.attachments.length} attachment${this.attachments.length === 1 ? '' : 's'} will be used as source material`)
				.setHeading();

			for (const attachment of this.attachments) {
				new Setting(contextSection)
					.setName(attachment.title)
					.setDesc(attachment.path ?? attachment.kind)
					.setClass('obsaide-quiz-note-attachment');
			}
		}

		// Questions section
		const questionsSection = contentEl.createDiv({ cls: 'obsaide-quiz-note-section' });
		new Setting(questionsSection)
			.setName('Questions')
			.setDesc('How many questions should the quiz have?')
			.setHeading();

		new Setting(questionsSection)
			.setName('Count')
			.setDesc('Number of questions to generate')
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

		new Setting(questionsSection)
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

		new Setting(questionsSection)
			.setName('Type')
			.setDesc('What question format?')
			.addDropdown((dropdown) => {
				for (const [value, label] of [
					['short-answer', 'Short answer'],
					['multiple-choice', 'Multiple choice'],
					['true-false', 'True / False'],
					['explain', 'Explain / Reasoning'],
					['application', 'Application / Scenario'],
					['mixed', 'Mixed'],
				] as const) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue('mixed');
				dropdown.onChange((value) => {
					this.type = value as QuizNoteOptions['type'];
				});
			});

		// Output section
		const outputSection = contentEl.createDiv({ cls: 'obsaide-quiz-note-section' });
		new Setting(outputSection)
			.setName('Output')
			.setDesc('Quiz output options')
			.setHeading();

		new Setting(outputSection)
			.setName('Include answers')
			.setDesc('Show collapsible answer callout under each question (recommended for study)')
			.addToggle((toggle) => {
				toggle.setValue(true);
				toggle.onChange((value) => {
					this.includeAnswerKey = value;
				});
			});

		// Note details section
		const detailsSection = contentEl.createDiv({ cls: 'obsaide-quiz-note-section' });
		new Setting(detailsSection)
			.setName('Note details')
			.setDesc('Where to save the quiz note')
			.setHeading();

		new Setting(detailsSection)
			.setName('Note name')
			.setDesc('Name for the quiz note (without .md extension)')
			.addText((text) => {
				text.setPlaceholder('Binary search quiz');
				text.onChange((value) => {
					this.name = value.trim();
				});
				// Set initial value
				text.inputEl.value = this.name;
			});

		// Folder picker
		const folderSetting = new Setting(detailsSection)
			.setName('Folder')
			.setDesc('Destination folder for the quiz note');

		this.folderButton = folderSetting.controlEl.createEl('button', {
			cls: 'obsaide-button',
			text: this.folderName || 'Choose folder…',
		});
		this.folderButton.addEventListener('click', () => this.openFolderPicker());

		// Loading state indicator
		this.loadingIndicator = contentEl.createDiv({ cls: 'obsaide-quiz-note-loading is-hidden' });

		// Buttons
		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		this.createButton = buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Create quiz note',
		});
		this.createButton.addEventListener('click', () => this.handleCreate());

		this.cancelButton = buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		});
		this.cancelButton.addEventListener('click', () => this.close());

		// Prevent Escape key from closing during generation
		const handleKeydown = (e: KeyboardEvent) => {
			if (this.isLoading && e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
			}
		};
		this.contentEl.addEventListener('keydown', handleKeydown);
		// Store handler to remove on close
		this.keydownHandler = handleKeydown;
	}

	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

	private questionCount = 10;
	private difficulty: QuizNoteOptions['difficulty'] = 'mixed';
	private type: QuizNoteOptions['type'] = 'mixed';
	private includeAnswerKey = true;
	private loadingIndicator!: HTMLElement;

	private openFolderPicker(): void {
		new FolderPickerModal(this.app, (folder: TFolder) => {
			this.folderPath = folder.path;
			this.folderName = folder.path === '' ? '/' : folder.path;
			this.folderButton.setText(this.folderName);
		}).open();
	}

	/** Set loading state - call from outside to show/hide loading */
	setLoading(loading: boolean): void {
		this.isLoading = loading;
		this.createButton.disabled = loading;
		this.createButton.setText(loading ? 'Creating quiz…' : 'Create quiz note');
		this.cancelButton.toggleClass('is-hidden', loading);
		this.loadingIndicator.toggleClass('is-hidden', !loading);
		if (loading) {
			this.loadingIndicator.empty();
			this.loadingIndicator.createDiv({ cls: 'obsaide-spinner' });
			// Show which file(s) are being used
			const sourceNames = this.attachments.map(a => a.title).join(', ');
			this.loadingIndicator.createSpan({ text: `Generating ${this.questionCount} questions from: ${sourceNames}` });
		}
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
		if (this.isLoading) return; // Prevent duplicate submissions

		const options: QuizNoteOptions = {
			questionCount: this.questionCount,
			difficulty: this.difficulty,
			type: this.type,
			includeAnswerKey: this.includeAnswerKey,
			name: this.name,
			folderPath: this.folderPath,
			attachments: this.attachments,
			isLoading: true,
		};

		this.setLoading(true);
		void this.onSubmit(options);
	}

	/** Called on generation failure to restore controls */
	setGenerationFailed(): void {
		this.isLoading = false;
		this.createButton.disabled = false;
		this.createButton.setText('Create quiz note');
		this.cancelButton.toggleClass('is-hidden', false);
		this.loadingIndicator.toggleClass('is-hidden', true);
	}

	override onClose(): void {
		// Prevent closing during generation
		if (this.isLoading) return;
		if (this.keydownHandler) {
			this.contentEl.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = null;
		}
		this.contentEl.empty();
	}
}