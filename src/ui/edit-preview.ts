import { Modal, Notice, setIcon, type App } from 'obsidian';
import {
	getActiveEditor,
	insertAfter,
	insertAtCursor,
	replaceRange,
	resolveProposalTarget,
	type ProposalTarget,
} from '../actions/apply';
import type { EditProposalTarget } from '../chat/conversation';
import { collapseDiff, diffLines, summarizeDiff } from '../utils/diff';
import { copyToClipboard } from './markdown';

export interface EditPreviewOptions {
	/** Markdown produced by Aide. */
	proposedText: string;
	/** Where it came from, when the reply can replace note content. */
	proposal?: EditProposalTarget;
}

type PreviewTab = 'diff' | 'result';

/**
 * Review-before-apply.
 *
 * Nothing here writes to a note until a button is pressed, and the replace
 * options disappear entirely when the target text can no longer be located.
 */
export class EditPreviewModal extends Modal {
	private tab: PreviewTab = 'diff';
	private bodyEl!: HTMLElement;
	private target: ProposalTarget | null = null;

	constructor(
		app: App,
		private readonly options: EditPreviewOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('obsaide-edit-modal');
		this.setTitle('Review change');

		const proposal = this.options.proposal;
		this.target = proposal ? resolveProposalTarget(this.app, proposal) : null;
		this.tab = proposal ? 'diff' : 'result';

		this.renderStatus(contentEl);
		if (proposal) this.renderTabs(contentEl);
		this.bodyEl = contentEl.createDiv({ cls: 'obsaide-edit-body' });
		this.renderBody();
		this.renderActions(contentEl);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private renderStatus(parent: HTMLElement): void {
		const proposal = this.options.proposal;
		if (!proposal) {
			parent.createEl('p', {
				cls: 'obsaide-modal-description',
				text: 'Choose where to put this reply. Nothing is written until you do.',
			});
			return;
		}

		if (!this.target) {
			this.warn(
				parent,
				`Open “${proposal.path}” to apply this change. You can still copy the result.`,
			);
			return;
		}
		if (!this.target.range) {
			this.warn(
				parent,
				'The original text is no longer in the note, so it cannot be replaced safely. Insert or copy instead.',
			);
			return;
		}
		if (this.target.drifted) {
			this.warn(
				parent,
				'The note changed since this was generated. ObsAIde found the original text elsewhere and will replace it there.',
			);
			return;
		}

		const diff = diffLines(proposal.originalText, this.options.proposedText);
		const summary = summarizeDiff(diff);
		parent.createEl('p', {
			cls: 'obsaide-modal-description',
			text: `${summary.added} lines added, ${summary.removed} removed. Review before applying.`,
		});
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
		const proposal = this.options.proposal;

		if (this.tab === 'result' || !proposal) {
			this.bodyEl.createEl('pre', {
				cls: 'obsaide-preview-body',
				text: this.options.proposedText,
			});
			return;
		}

		const diff = collapseDiff(diffLines(proposal.originalText, this.options.proposedText));
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
		const proposal = this.options.proposal;
		const text = this.options.proposedText;

		if (proposal && this.target?.range) {
			const range = this.target.range;
			const editor = this.target.editor;
			this.button(
				footer,
				proposal.scope === 'document' ? 'Replace note content' : 'Replace selection',
				true,
				() => {
					replaceRange(editor, range, text);
					new Notice('Note updated. Undo with Ctrl/Cmd+Z if needed.');
					this.close();
				},
			);
			this.button(footer, 'Insert below', false, () => {
				insertAfter(editor, range.to, text);
				new Notice('Inserted below the original.');
				this.close();
			});
		}

		this.button(footer, 'Insert at cursor', false, () => {
			const editor = this.target?.editor ?? getActiveEditor(this.app);
			if (!editor) {
				new Notice('Open a note in the editor first.');
				return;
			}
			insertAtCursor(editor, text);
			new Notice('Inserted at the cursor.');
			this.close();
		});

		this.button(footer, 'Copy', false, () => {
			void copyToClipboard(text, 'Copied to the clipboard');
			this.close();
		});

		this.button(footer, 'Cancel', false, () => this.close());
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
