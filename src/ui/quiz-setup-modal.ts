import { Modal, Setting, type App } from 'obsidian';
import type { QuizSetupOptions } from '../chat/quiz';

/** Modal for configuring quiz settings before starting. */
export class QuizSetupModal extends Modal {
	constructor(
		app: App,
		private readonly onSubmit: (setup: QuizSetupOptions) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-quiz-setup-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'obsaide-quiz-setup-header' });
		header.createEl('h3', { text: 'Start quiz' });

		// Number of questions
		const questionsSetting = new Setting(contentEl)
			.setName('Number of questions')
			.setDesc('How many questions should the quiz have?');
		const questionsSelect = questionsSetting.controlEl.createEl('select', { cls: 'obsaide-quiz-select' });
		for (const [value, label] of [
			['5', '5 questions'],
			['10', '10 questions'],
			['15', '15 questions'],
			['20', '20 questions'],
			['0', 'Unlimited'],
		] as const) {
			questionsSelect.createEl('option', { value, text: label });
		}
		questionsSelect.value = '10';

		// Difficulty
		const difficultySetting = new Setting(contentEl)
			.setName('Difficulty')
			.setDesc('What level of questions should be asked?');
		const difficultySelect = difficultySetting.controlEl.createEl('select', { cls: 'obsaide-quiz-select' });
		for (const [value, label] of [
			['easy', 'Easy'],
			['medium', 'Medium'],
			['hard', 'Hard'],
			['mixed', 'Mixed'],
		] as const) {
			difficultySelect.createEl('option', { value, text: label });
		}
		difficultySelect.value = 'mixed';

		// Style
		const styleSetting = new Setting(contentEl)
			.setName('Answer style')
			.setDesc('How should you answer the questions?');
		const styleSelect = styleSetting.controlEl.createEl('select', { cls: 'obsaide-quiz-select' });
		for (const [value, label] of [
			['short-answer', 'Short answer'],
			['multiple-choice', 'Multiple choice'],
			['mixed', 'Mixed'],
		] as const) {
			styleSelect.createEl('option', { value, text: label });
		}
		styleSelect.value = 'short-answer';

		// Buttons
		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const startButton = buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Start quiz',
		});
		startButton.addEventListener('click', () => {
			const setup: QuizSetupOptions = {
				totalQuestions: Number.parseInt(questionsSelect.value, 10),
				difficulty: difficultySelect.value as QuizSetupOptions['difficulty'],
				style: styleSelect.value as QuizSetupOptions['style'],
			};
			this.onSubmit(setup);
			this.close();
		});

		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}