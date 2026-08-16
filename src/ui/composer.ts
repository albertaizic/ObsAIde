import { setIcon, setTooltip } from 'obsidian';
import type { Attachment } from '../context/types';
import { summarize } from '../utils/text';

export interface ComposerCallbacks {
	onSend: (text: string) => void;
	onStop: () => void;
	/** Anchor for the "add context" menu. */
	onAddContext: (anchor: HTMLElement) => void;
	onRemoveAttachment: (id: string) => void;
}

const MAX_TEXTAREA_HEIGHT = 220;

/** Prompt input, attachment chips and the send/stop control. */
export class Composer {
	private readonly attachmentsEl: HTMLElement;
	private readonly textarea: HTMLTextAreaElement;
	private readonly sendButton: HTMLButtonElement;
	private readonly addButton: HTMLButtonElement;
	private generating = false;

	constructor(
		container: HTMLElement,
		private readonly callbacks: ComposerCallbacks,
	) {
		const root = container.createDiv({ cls: 'obsaide-composer' });

		const contextRow = root.createDiv({ cls: 'obsaide-context-row' });
		this.addButton = contextRow.createEl('button', { cls: 'obsaide-chip is-action' });
		const addIcon = this.addButton.createSpan({ cls: 'obsaide-chip-icon' });
		setIcon(addIcon, 'plus');
		this.addButton.createSpan({ cls: 'obsaide-chip-label', text: 'Add context' });
		setTooltip(this.addButton, 'Attach the current note or a selection');
		this.addButton.addEventListener('click', () =>
			this.callbacks.onAddContext(this.addButton),
		);
		this.attachmentsEl = contextRow.createDiv({ cls: 'obsaide-chips' });

		const inputRow = root.createDiv({ cls: 'obsaide-input-row' });
		this.textarea = inputRow.createEl('textarea', {
			cls: 'obsaide-textarea',
			attr: {
				rows: '1',
				placeholder: 'Ask Aide…',
				'aria-label': 'Message for Aide',
			},
		});
		this.textarea.addEventListener('input', () => this.autoGrow());
		this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));

		this.sendButton = inputRow.createEl('button', {
			cls: 'obsaide-send',
			attr: { 'aria-label': 'Send' },
		});
		setIcon(this.sendButton, 'arrow-up');
		setTooltip(this.sendButton, 'Send');
		this.sendButton.addEventListener('click', () => this.submit());

		root.createDiv({
			cls: 'obsaide-hint',
			text: 'Enter to send · Shift+Enter for a new line',
		});
	}

	focus(): void {
		this.textarea.focus();
	}

	setGenerating(generating: boolean): void {
		this.generating = generating;
		this.sendButton.empty();
		setIcon(this.sendButton, generating ? 'square' : 'arrow-up');
		setTooltip(this.sendButton, generating ? 'Stop generating' : 'Send');
		this.sendButton.setAttribute('aria-label', generating ? 'Stop generating' : 'Send');
		this.sendButton.toggleClass('is-stop', generating);
		this.textarea.toggleAttribute('readonly', generating);
	}

	setText(text: string): void {
		this.textarea.value = text;
		this.autoGrow();
	}

	setAttachments(attachments: readonly Attachment[]): void {
		this.attachmentsEl.empty();
		for (const attachment of attachments) {
			const chip = this.attachmentsEl.createDiv({ cls: 'obsaide-chip' });
			const icon = chip.createSpan({ cls: 'obsaide-chip-icon' });
			setIcon(icon, attachment.kind === 'selection' ? 'text-cursor-input' : 'file-text');
			chip.createSpan({
				cls: 'obsaide-chip-label',
				text: summarize(attachment.title, 28),
			});
			setTooltip(chip, attachment.path ?? attachment.title);

			const remove = chip.createEl('button', {
				cls: 'obsaide-chip-remove',
				attr: { 'aria-label': `Remove ${attachment.title}` },
			});
			setIcon(remove, 'x');
			remove.addEventListener('click', () =>
				this.callbacks.onRemoveAttachment(attachment.id),
			);
		}
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		// Shift+Enter inserts a newline; every other modifier still sends, which
		// matches what people expect from a chat box.
		if (event.shiftKey) return;
		if (event.isComposing) return;
		event.preventDefault();
		this.submit();
	}

	private submit(): void {
		if (this.generating) {
			this.callbacks.onStop();
			return;
		}
		const text = this.textarea.value.trim();
		if (!text) return;
		this.textarea.value = '';
		this.autoGrow();
		this.callbacks.onSend(text);
	}

	private autoGrow(): void {
		// Measured, so it has to be applied inline; `setCssStyles` is Obsidian's
		// sanctioned way to do that.
		this.textarea.setCssStyles({ height: 'auto' });
		const height = Math.min(this.textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
		this.textarea.setCssStyles({ height: `${height}px` });
	}
}
