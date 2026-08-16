import { Modal, Platform, setIcon, setTooltip, type App } from 'obsidian';
import { ASSISTANT_NAME } from '../constants';
import { captureNote, isDuplicateAttachment } from '../context/collect';
import type { Attachment } from '../context/types';
import { formatApproxTokens, summarize } from '../utils/text';
import { NotePickerModal } from './note-picker';

export interface AskModalOptions {
	/** Context captured from the editor before the modal opened. */
	attachments: Attachment[];
	initialQuestion?: string;
	onSubmit: (question: string, attachments: Attachment[]) => void;
}

/**
 * The Ask Aide entry point.
 *
 * The context that will be sent is listed and removable before anything leaves
 * the vault, which is the whole point of the modal: nothing is transmitted
 * until the user presses the button.
 */
export class AskAideModal extends Modal {
	private attachments: Attachment[];
	private question: string;
	private chipsEl!: HTMLElement;
	private previewEl!: HTMLElement;

	constructor(
		app: App,
		private readonly options: AskModalOptions,
	) {
		super(app);
		this.attachments = [...options.attachments];
		this.question = options.initialQuestion ?? '';
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('obsaide-ask-modal');
		this.setTitle(`Ask ${ASSISTANT_NAME}`);

		contentEl.createEl('p', {
			cls: 'obsaide-modal-description',
			text: 'Only the context listed below is sent, together with your question.',
		});

		const contextRow = contentEl.createDiv({ cls: 'obsaide-context-row' });
		this.chipsEl = contextRow.createDiv({ cls: 'obsaide-chips' });
		const addButton = contextRow.createEl('button', { cls: 'obsaide-chip is-action' });
		const addIcon = addButton.createSpan({ cls: 'obsaide-chip-icon' });
		setIcon(addIcon, 'plus');
		addButton.createSpan({ cls: 'obsaide-chip-label', text: 'Add note' });
		addButton.addEventListener('click', () => {
			new NotePickerModal(this.app, (file) => this.addAttachment(captureNote(file))).open();
		});

		this.previewEl = contentEl.createDiv({ cls: 'obsaide-ask-preview' });

		const textarea = contentEl.createEl('textarea', {
			cls: 'obsaide-ask-input',
			attr: {
				rows: '4',
				placeholder: 'What would you like to know?',
				'aria-label': 'Your question',
			},
		});
		textarea.value = this.question;
		textarea.addEventListener('input', () => {
			this.question = textarea.value;
		});
		textarea.addEventListener('keydown', (event) => {
			const modifier = Platform.isMacOS ? event.metaKey : event.ctrlKey;
			if (event.key === 'Enter' && modifier) {
				event.preventDefault();
				this.submit();
			}
		});
		window.setTimeout(() => textarea.focus(), 0);

		const footer = contentEl.createDiv({ cls: 'obsaide-modal-footer' });
		footer.createSpan({
			cls: 'obsaide-hint',
			text: `${Platform.isMacOS ? '⌘' : 'Ctrl'}+Enter to send`,
		});
		const submit = footer.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: `Ask ${ASSISTANT_NAME}`,
		});
		submit.addEventListener('click', () => this.submit());

		this.renderContext();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private addAttachment(attachment: Attachment): void {
		if (isDuplicateAttachment(this.attachments, attachment)) return;
		this.attachments.push(attachment);
		this.renderContext();
	}

	private renderContext(): void {
		this.chipsEl.empty();
		if (this.attachments.length === 0) {
			this.chipsEl.createSpan({
				cls: 'obsaide-hint',
				text: 'No vault context attached.',
			});
		}

		for (const attachment of this.attachments) {
			const chip = this.chipsEl.createDiv({ cls: 'obsaide-chip' });
			const icon = chip.createSpan({ cls: 'obsaide-chip-icon' });
			setIcon(icon, attachment.kind === 'selection' ? 'text-cursor-input' : 'file-text');
			chip.createSpan({
				cls: 'obsaide-chip-label',
				text: summarize(attachment.title, 32),
			});
			setTooltip(chip, attachment.path ?? attachment.title);

			const remove = chip.createEl('button', {
				cls: 'obsaide-chip-remove',
				attr: { 'aria-label': `Remove ${attachment.title}` },
			});
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				this.attachments = this.attachments.filter((item) => item.id !== attachment.id);
				this.renderContext();
			});
		}

		this.previewEl.empty();
		const selection = this.attachments.find(
			(attachment) => attachment.kind === 'selection' && attachment.text,
		);
		if (!selection?.text) return;

		const details = this.previewEl.createEl('details', { cls: 'obsaide-preview' });
		details.createEl('summary', {
			text: `Selected text (${formatApproxTokens(selection.text)})`,
		});
		details.createEl('pre', { cls: 'obsaide-preview-body', text: selection.text });
	}

	private submit(): void {
		const question = this.question.trim();
		if (!question && this.attachments.length === 0) return;
		const attachments = this.attachments;
		this.close();
		this.options.onSubmit(question, attachments);
	}
}
