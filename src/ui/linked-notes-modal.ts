import { Modal, type App } from 'obsidian';
import type { LinkedNoteCandidate } from '../context/linked-notes';

/**
 * Lets the user choose which linked notes to attach.
 *
 * Nothing is attached automatically — the caller only receives the notes the
 * user checked and pressed "Add selected" for.
 */
export class LinkedNotesModal extends Modal {
	private readonly selected = new Set<string>();

	constructor(
		app: App,
		private readonly candidates: readonly LinkedNoteCandidate[],
		private readonly onAdd: (chosen: LinkedNoteCandidate[]) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('obsaide-linked-notes-modal');
		this.setTitle(
			this.candidates.length === 1
				? 'This note links to 1 note'
				: `This note links to ${this.candidates.length} notes`,
		);

		const list = contentEl.createDiv({ cls: 'obsaide-linked-notes-list' });
		for (const candidate of this.candidates) {
			const row = list.createEl('label', { cls: 'obsaide-linked-notes-row' });
			const checkbox = row.createEl('input', { type: 'checkbox' });
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selected.add(candidate.path);
				else this.selected.delete(candidate.path);
			});
			const text = row.createDiv({ cls: 'obsaide-linked-notes-text' });
			text.createDiv({ cls: 'obsaide-linked-notes-title', text: candidate.title });
			if (candidate.sourceTitles.length > 0) {
				text.createDiv({
					cls: 'obsaide-linked-notes-source',
					text: `Linked from: ${candidate.sourceTitles.join(', ')}`,
				});
			}
		}

		const footer = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		footer.createEl('button', { cls: 'obsaide-button', text: 'Cancel' }).addEventListener(
			'click',
			() => this.close(),
		);
		footer
			.createEl('button', { cls: 'obsaide-button is-cta', text: 'Add selected' })
			.addEventListener('click', () => {
				const chosen = this.candidates.filter((c) => this.selected.has(c.path));
				this.close();
				this.onAdd(chosen);
			});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
