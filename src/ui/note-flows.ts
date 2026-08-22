import { Notice, TFolder, type App } from 'obsidian';
import { insertAtAnchor, resolveEditTarget, type ResolvedEditTarget } from '../actions/edit-target';
import { buildConversationExportContent, sanitizeExportName, type ConversationExportMode as ExportMode } from '../chat/export';
import type { Conversation, ConversationMessage } from '../chat/conversation';
import type ObsAidePlugin from '../main';
import { sanitizeNoteName, uniqueNotePath } from '../utils/text';
import { ConversationExportModal } from './export-modal';
import { EditPreviewModal } from './edit-preview';
import { NotePickerModal } from './note-picker';
import { PromptModal } from './prompt-modal';

/**
 * Everything that takes an assistant reply (or a whole conversation) and turns
 * it into vault content: insert at the original cursor, append to or create a
 * note, diff-review a proposed change, export as Markdown.
 *
 * Targets always come from anchors captured when the request was made — never
 * from whatever leaf has focus by the time a button is clicked.
 */
export class NoteFlows {
	constructor(
		private readonly app: App,
		private readonly plugin: ObsAidePlugin,
	) {}

	resolveTarget(message: ConversationMessage): ResolvedEditTarget | null {
		return resolveEditTarget(
			this.app,
			message.anchor,
			this.plugin.editTargets.recall(message.id),
		);
	}

	openReview(message: ConversationMessage): void {
		new EditPreviewModal(this.app, {
			proposedText: message.text,
			anchor: message.anchor,
			replacesAnchor: message.replacesAnchor,
			preferredView: this.plugin.editTargets.recall(message.id),
		}).open();
	}

	async insertAtCursor(message: ConversationMessage): Promise<void> {
		const target = this.resolveTarget(message);
		if (!target) {
			new Notice(
				message.anchor
					? `Open “${message.anchor.path}” to insert this reply.`
					: 'This reply is not linked to a note. Copy it instead.',
			);
			return;
		}
		try {
			await insertAtAnchor(this.app, target, message.text);
			new Notice('Inserted at the cursor. Undo with Ctrl/Cmd+Z if needed.');
		} catch {
			new Notice('Could not write to the note.');
		}
	}

	/** Append the reply to an existing note. */
	appendToNote(message: ConversationMessage): void {
		new NotePickerModal(this.app, (file) => {
			void (async () => {
				try {
					const content = await this.app.vault.cachedRead(file);
					const separator = content.endsWith('\n') ? '' : '\n';
					await this.app.vault.modify(file, `${content}${separator}\n\n---\n\n${message.text}`);
					new Notice(`Appended to ${file.basename}`);
					// Optionally open the note
					const leaf = this.app.workspace.getLeaf(false);
					if (leaf) await leaf.openFile(file);
				} catch {
					new Notice('Could not append to the note.');
				}
			})();
		}).open();
	}

	/** Create a new note with the reply as content. */
	createNoteFromReply(message: ConversationMessage): void {
		new PromptModal(this.app, {
			title: 'Create new note',
			description: 'Enter a name for the new note (without .md extension)',
			placeholder: 'My AI Response',
			submitText: 'Create',
			onSubmit: (name) => {
				void (async () => {
					const trimmed = name.trim();
					if (!trimmed) {
						new Notice('Please enter a note name.');
						return;
					}
					const folder = this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
					const finalPath = uniqueNotePath(folder.path, sanitizeNoteName(trimmed), (path) =>
						this.app.vault.getAbstractFileByPath(path) !== null,
					);
					try {
						const file = await this.app.vault.create(finalPath, message.text);
						new Notice(`Created ${file.basename}`);
						const leaf = this.app.workspace.getLeaf(false);
						if (leaf) await leaf.openFile(file);
					} catch {
						new Notice('Could not create the note.');
					}
				})();
			},
		}).open();
	}

	/**
	 * Export the current conversation as a Markdown note.
	 *
	 * Name, folder and what to include are all decided in one modal before
	 * "Export" is pressed — there is no follow-up question after that.
	 */
	exportConversation(conversation: Conversation): void {
		const defaultFolder = this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
		new ConversationExportModal(this.app, {
			defaultName: conversation.title || 'Conversation Export',
			defaultFolder: defaultFolder.path,
			onExport: ({ name, folder, mode }) => this.writeConversationNote(conversation, name, folder, mode),
		}).open();
	}

	private writeConversationNote(
		conversation: Conversation,
		name: string,
		folderPath: string,
		mode: ExportMode,
	): void {
		const sanitized = sanitizeExportName(name);
		const resolvedFolder = folderPath.trim()
			? this.app.vault.getAbstractFileByPath(folderPath.trim())
			: null;
		const folder = resolvedFolder instanceof TFolder ? resolvedFolder : this.app.vault.getRoot();
		const finalPath = uniqueNotePath(folder.path, sanitized, (path) =>
			this.app.vault.getAbstractFileByPath(path) !== null,
		);

		// Use the final unique filename (without .md) as the title in the exported note
		const finalName = finalPath.split(/[/\\]/).pop()?.replace(/\.md$/, '') ?? sanitized;
		const content = buildConversationExportContent(conversation, finalName, mode);

		void this.app.vault.create(finalPath, content).then(async (file) => {
			new Notice(`Exported to ${file.basename}`);
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) await leaf.openFile(file);
		}).catch(() => {
			new Notice('Could not create the note.');
		});
	}
}
