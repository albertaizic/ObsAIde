import { Menu, setIcon, setTooltip, type App } from 'obsidian';
import type { Attachment } from '../context/types';
import { summarize } from '../utils/text';
import { attachmentIcon, attachmentLabel } from './attachment-chip';
import { NoteAutocomplete, type NoteAttachment } from './note-autocomplete';

/** Type for Obsidian Menu item (loose typing to match Obsidian's API). */
type MenuItem = {
	setTitle: (title: string) => MenuItem;
	setChecked: (checked: boolean) => MenuItem;
	onClick: (fn: () => void) => MenuItem;
};

export interface ComposerCallbacks {
	onSend: (text: string) => void;
	onStop: () => void;
	/** Anchor for the "add context" menu. */
	onAddContext: (anchor: HTMLElement) => void;
	/** Anchor for the built-in + custom actions menu. */
	onOpenActions: (anchor: HTMLElement) => void;
	onRemoveAttachment: (id: string) => void;
	/** Show which notes a folder attachment covers. */
	onInspectAttachment: (attachment: Attachment) => void;
	/** Add a note attachment from @ autocomplete. */
	onAddNoteAttachment: (attachment: NoteAttachment) => void;
	/** Called when response length selector changes. */
	onChangeLength?: (length: 'short' | 'normal' | 'detailed') => void;
	/** Called when context scope selector changes. */
	onChangeScope?: (scope: 'none' | 'selection' | 'section' | 'note' | 'linked' | 'folder') => void;
}

const MAX_TEXTAREA_HEIGHT = 220;

/** Prompt input, attachment chips and the send/stop control. */
export class Composer {
	private readonly attachmentsEl: HTMLElement;
	private readonly textarea: HTMLTextAreaElement;
	private readonly sendButton: HTMLButtonElement;
	private readonly addButton: HTMLButtonElement;
	private readonly actionsButton: HTMLButtonElement;
	private readonly lengthButton: HTMLButtonElement;
	private readonly scopeButton: HTMLButtonElement;
	private readonly autocomplete: NoteAutocomplete;
	private generating = false;

	constructor(
		container: HTMLElement,
		private readonly callbacks: ComposerCallbacks,
		app: App,
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
		this.actionsButton = contextRow.createEl('button', { cls: 'obsaide-chip is-action' });
		const actionsIcon = this.actionsButton.createSpan({ cls: 'obsaide-chip-icon' });
		setIcon(actionsIcon, 'zap');
		this.actionsButton.createSpan({ cls: 'obsaide-chip-label', text: 'Actions' });
		setTooltip(this.actionsButton, 'Run a built-in or custom Aide action');
		this.actionsButton.addEventListener('click', () =>
			this.callbacks.onOpenActions(this.actionsButton),
		);
		this.attachmentsEl = contextRow.createDiv({ cls: 'obsaide-chips' });

		// Secondary controls row (response length, context scope)
		const controlsRow = root.createDiv({ cls: 'obsaide-controls-row' });
		this.lengthButton = controlsRow.createEl('button', { cls: 'obsaide-control-select' });
		this.lengthButton.addEventListener('click', () => this.showLengthMenu());
		this.scopeButton = controlsRow.createEl('button', { cls: 'obsaide-control-select' });
		this.scopeButton.addEventListener('click', () => this.showScopeMenu());

		const inputRow = root.createDiv({ cls: 'obsaide-input-row' });
		this.textarea = inputRow.createEl('textarea', {
			cls: 'obsaide-textarea',
			attr: {
				rows: '1',
				placeholder: 'Ask Aide…',
				'aria-label': 'Message for Aide',
			},
		});
		this.textarea.addEventListener('input', () => this.onInput());
		this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));

		this.sendButton = inputRow.createEl('button', {
			cls: 'obsaide-send',
			attr: { 'aria-label': 'Send' },
		});
		setIcon(this.sendButton, 'arrow-up');
		setTooltip(this.sendButton, 'Send');
		this.sendButton.addEventListener('click', () => this.stopOrSend());

		root.createDiv({
			cls: 'obsaide-hint',
			text: 'Enter to send · Shift+Enter for a new line',
		});

		// @note autocomplete
		this.autocomplete = new NoteAutocomplete({
			app,
			onSelect: (attachment) => this.callbacks.onAddNoteAttachment?.(attachment),
			onClose: () => {},
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
			setIcon(icon, attachmentIcon(attachment.kind));

			const label = chip.createSpan({
				cls: 'obsaide-chip-label',
				text: summarize(attachmentLabel(attachment), 30),
			});
			if (attachment.role === 'supporting') {
				chip.createSpan({ cls: 'obsaide-chip-role', text: 'context' });
			}
			setTooltip(chip, attachment.path ?? attachment.title);

			// A folder chip stands for several notes, so make the list reachable.
			if (attachment.kind === 'folder') {
				label.addClass('is-clickable');
				label.addEventListener('click', () =>
					this.callbacks.onInspectAttachment(attachment),
				);
			}

			const remove = chip.createEl('button', {
				cls: 'obsaide-chip-remove',
				attr: { 'aria-label': `Remove ${attachment.title}` },
			});
			setIcon(remove, 'x');
			remove.addEventListener('click', () =>
				this.callbacks.onRemoveAttachment(attachment.id),
			);
		}

		// Update autocomplete with existing note attachments for deduplication
		const noteAttachments = attachments
			.filter(
				(a): a is Attachment & { kind: 'note'; path: string } =>
					a.kind === 'note' && !!a.path,
			)
			.map((a) => ({
				id: a.id,
				kind: 'note' as const,
				path: a.path,
				title: a.title,
				role: a.role ?? 'primary',
			}));
		this.autocomplete.updateExistingAttachments(noteAttachments);
	}

	private onInput(): void {
		this.autoGrow();
		const cursorPos = this.textarea.selectionStart;
		this.autocomplete.handleInput(this.textarea, cursorPos);
	}

	private onKeyDown(event: KeyboardEvent): void {
		// Let autocomplete handle navigation keys first
		if (this.autocomplete.handleKeyDown(event)) {
			return;
		}
		if (event.key !== 'Enter') return;
		// Shift+Enter inserts a newline; every other modifier still sends, which
		// matches what people expect from a chat box.
		if (event.shiftKey) return;
		if (event.isComposing) return;
		event.preventDefault();
		this.submit();
	}

	/** The send button doubles as stop; Enter never stops a running reply. */
	private stopOrSend(): void {
		if (this.generating) {
			this.callbacks.onStop();
			return;
		}
		this.submit();
	}

	private submit(): void {
		// Drafting the next message while a reply streams is allowed, but Enter
		// must not send it into a busy conversation.
		if (this.generating) return;
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

	/** Update the response length button label. */
	setLength(length: 'short' | 'normal' | 'detailed'): void {
		const labels: Record<string, string> = { short: 'Short', normal: 'Normal', detailed: 'Detailed' };
		this.lengthButton.setText(labels[length] ?? 'Normal');
		setTooltip(this.lengthButton, `Response length: ${labels[length]}. Click to change.`);
	}

	/** Update the context scope button label. */
	setScope(scope: 'none' | 'selection' | 'section' | 'note' | 'linked' | 'folder'): void {
		const labels: Record<string, string> = {
			none: 'None',
			selection: 'Selection',
			section: 'Section',
			note: 'Note',
			linked: 'Linked notes',
			folder: 'Folder',
		};
		this.scopeButton.setText(labels[scope] ?? 'Selection');
		setTooltip(this.scopeButton, `Context scope: ${labels[scope]}. Click to change.`);
	}

	private showLengthMenu(): void {
		const menu = new Menu();
		const currentLength = this.lengthButton.textContent ?? 'Normal';

		for (const [value, label] of [
			['short', 'Short'],
			['normal', 'Normal'],
			['detailed', 'Detailed'],
		] as const) {
			menu.addItem((item: MenuItem) => {
				item
					.setTitle(label)
					.setChecked(value === currentLength)
					.onClick(() => {
						this.setLength(value);
						this.callbacks.onChangeLength?.(value);
					});
				return;
			});
		}

		const rect = this.lengthButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private showScopeMenu(): void {
		const menu = new Menu();
		const currentScope = this.scopeButton.textContent ?? 'Selection';

		const scopes: Array<'none' | 'selection' | 'section' | 'note' | 'linked' | 'folder'> = ['none', 'selection', 'section', 'note', 'linked', 'folder'];
		const scopeLabels: Record<string, string> = {
			none: 'None',
			selection: 'Selection',
			section: 'Section',
			note: 'Note',
			linked: 'Linked notes',
			folder: 'Folder',
		};

		for (const value of scopes) {
			menu.addItem((item: MenuItem) => {
				item
					.setTitle(scopeLabels[value] ?? value)
					.setChecked(value === currentScope)
					.onClick(() => {
						this.setScope(value);
						this.callbacks.onChangeScope?.(value);
					});
				return;
			});
		}

		const rect = this.scopeButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	/** Clean up autocomplete and event listeners. */
	destroy(): void {
		this.autocomplete.destroy();
	}
}
