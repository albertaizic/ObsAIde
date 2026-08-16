import { Modal, Notice, setIcon, type App, type MarkdownView } from 'obsidian';
import type { NoteEditAnchor } from '../actions/anchor';
import {
	insertAtAnchor,
	insertBelowSelection,
	replaceSelection,
	resolveEditTarget,
	type ResolvedEditTarget,
} from '../actions/edit-target';
import { collapseDiff, diffLines, summarizeDiff } from '../utils/diff';
import { copyToClipboard } from './markdown';

export interface EditPreviewOptions {
	/** Markdown produced by Aide. */
	proposedText: string;
	/** The note, caret and selection the reply came from. */
	anchor?: NoteEditAnchor;
	/** The reply was generated to replace the anchored text. */
	replacesAnchor?: boolean;
	/** The exact editor the request started in, when it is still known. */
	preferredView?: MarkdownView | null;
}

type PreviewTab = 'diff' | 'result';

/**
 * Review-before-apply.
 *
 * The target note is resolved from the anchor captured when the request was
 * made, never from whichever leaf happens to have focus — by the time this
 * modal is open, focus is on the modal itself. Nothing is written until a
 * button is pressed, and options that cannot be performed safely are not shown.
 */
export class EditPreviewModal extends Modal {
	private tab: PreviewTab = 'result';
	private bodyEl!: HTMLElement;
	private target: ResolvedEditTarget | null = null;

	constructor(
		app: App,
		private readonly options: EditPreviewOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('obsaide-edit-modal');
		this.setTitle(this.showsDiff() ? 'Review change' : 'Use in note');

		this.target = resolveEditTarget(
			this.app,
			this.options.anchor,
			this.options.preferredView,
		);
		this.tab = this.showsDiff() ? 'diff' : 'result';

		this.renderStatus(contentEl);
		if (this.showsDiff()) this.renderTabs(contentEl);
		this.bodyEl = contentEl.createDiv({ cls: 'obsaide-edit-body' });
		this.renderBody();
		this.renderActions(contentEl);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	/** A diff only makes sense when there is an original to compare against. */
	private showsDiff(): boolean {
		return Boolean(this.options.replacesAnchor && this.options.anchor?.selection?.text);
	}

	private renderStatus(parent: HTMLElement): void {
		const anchor = this.options.anchor;

		if (!anchor) {
			this.warn(
				parent,
				'This reply is not linked to a note, so it can only be copied. Ask again from a note to insert it.',
			);
			return;
		}

		if (!this.target) {
			this.warn(
				parent,
				`Open “${anchor.path}” in the editor to insert this. You can still copy it.`,
			);
			return;
		}

		parent.createEl('p', {
			cls: 'obsaide-modal-description',
			text: `Target: ${anchor.path}`,
		});

		if (this.showsDiff() && this.target.selection) {
			if (this.target.selection.drifted) {
				this.warn(
					parent,
					'The note changed since this was generated. ObsAIde found the original text elsewhere and will replace it there.',
				);
			} else {
				const diff = diffLines(anchor.selection?.text ?? '', this.options.proposedText);
				const summary = summarizeDiff(diff);
				parent.createEl('p', {
					cls: 'obsaide-modal-description',
					text: `${summary.added} lines added, ${summary.removed} removed.`,
				});
			}
		} else if (this.options.replacesAnchor) {
			this.warn(
				parent,
				'The original text is no longer in the note, so it cannot be replaced safely. Insert or copy instead.',
			);
		}

		if (this.target.cursorMoved) {
			this.warn(
				parent,
				'The note is shorter than it was, so the cursor position has been moved to the nearest valid spot.',
			);
		}
	}

	private warn(parent: HTMLElement, text: string): void {
		const box = parent.createDiv({ cls: 'obsaide-error' });
		const icon = box.createSpan({ cls: 'obsaide-error-icon' });
		setIcon(icon, 'alert-triangle');
		box.createSpan({ cls: 'obsaide-error-text', text });
	}

	private renderTabs(parent: HTMLElement): void {
		const tabs = parent.createDiv({ cls: 'obsaide-tabs' });
		const makeTab = (tab: PreviewTab, label: string): void => {
			const button = tabs.createEl('button', { cls: 'obsaide-tab', text: label });
			button.toggleClass('is-active', this.tab === tab);
			button.addEventListener('click', () => {
				this.tab = tab;
				tabs.findAll('.obsaide-tab').forEach((el) => el.removeClass('is-active'));
				button.addClass('is-active');
				this.renderBody();
			});
		};
		makeTab('diff', 'Changes');
		makeTab('result', 'Result');
	}

	private renderBody(): void {
		this.bodyEl.empty();
		const original = this.options.anchor?.selection?.text;

		if (this.tab === 'result' || !original) {
			this.bodyEl.createEl('pre', {
				cls: 'obsaide-preview-body',
				text: this.options.proposedText,
			});
			return;
		}

		const diff = collapseDiff(diffLines(original, this.options.proposedText));
		const list = this.bodyEl.createDiv({ cls: 'obsaide-diff' });
		for (const line of diff) {
			const row = list.createDiv({ cls: `obsaide-diff-line is-${line.kind}` });
			row.createSpan({
				cls: 'obsaide-diff-marker',
				text: line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ',
			});
			row.createSpan({ cls: 'obsaide-diff-text', text: line.text || ' ' });
		}
	}

	private renderActions(parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const text = this.options.proposedText;
		const target = this.target;
		const selection = target?.selection ?? null;

		if (target && selection) {
			this.button(
				footer,
				this.options.anchor?.wholeDocument ? 'Replace note content' : 'Replace selection',
				this.showsDiff(),
				() => {
					void this.apply(replaceSelection(this.app, target, selection, text), 'Note updated.');
				},
			);
			this.button(footer, 'Insert below', false, () => {
				void this.apply(
					insertBelowSelection(this.app, target, selection, text),
					'Inserted below the original.',
				);
			});
		}

		if (target) {
			this.button(footer, 'Insert at cursor', !this.showsDiff(), () => {
				void this.apply(
					insertAtAnchor(this.app, target, text),
					'Inserted at the cursor.',
				);
			});
		}

		this.button(footer, 'Copy', false, () => {
			void copyToClipboard(text, 'Copied to the clipboard');
			this.close();
		});

		this.button(footer, 'Cancel', false, () => this.close());
	}

	private async apply(work: Promise<void>, message: string): Promise<void> {
		this.close();
		try {
			await work;
			new Notice(`${message} Undo with Ctrl/Cmd+Z if needed.`);
		} catch {
			new Notice('Could not write to the note.');
		}
	}

	private button(
		parent: HTMLElement,
		label: string,
		cta: boolean,
		onClick: () => void,
	): void {
		const button = parent.createEl('button', {
			cls: `obsaide-button${cta ? ' is-cta' : ''}`,
			text: label,
		});
		button.addEventListener('click', onClick);
	}
}
