import { Modal, type App } from 'obsidian';
import { listFolderNotes } from '../context/collect';
import { describeNoteCount } from '../context/folder';
import type { Attachment } from '../context/types';

/**
 * Shows exactly which Markdown notes an attachment contributes.
 *
 * Attaching a folder is the one action where the chip alone does not tell the
 * whole story, so the list is one click away before anything is sent.
 */
export class AttachmentDetailsModal extends Modal {
	constructor(
		app: App,
		private readonly attachment: Attachment,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('obsaide-details-modal');
		this.setTitle(this.attachment.title);

		if (this.attachment.kind !== 'folder') {
			contentEl.createEl('p', {
				cls: 'obsaide-modal-description',
				text: this.attachment.path ?? this.attachment.title,
			});
			return;
		}

		const notes = listFolderNotes(this.app, this.attachment.path ?? '');
		contentEl.createEl('p', {
			cls: 'obsaide-modal-description',
			text: `${describeNoteCount(notes.length)} will be sent as context. Files that are not Markdown are ignored.`,
		});

		const list = contentEl.createEl('ul', { cls: 'obsaide-note-list' });
		for (const note of notes) {
			list.createEl('li', { text: note.path });
		}
		if (notes.length === 0) {
			contentEl.createEl('p', {
				cls: 'obsaide-empty-hint',
				text: 'This folder no longer contains any Markdown notes.',
			});
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
