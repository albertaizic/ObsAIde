import { FuzzySuggestModal, type App, setIcon } from 'obsidian';
import { listFolderNotes, listNoteFolders } from '../context/collect';
import { describeNoteCount, folderDisplayName } from '../context/folder';

/** Represents a selectable folder source, including the vault root. */
export interface FolderSource {
	/** Path of the folder, or '' for vault root. */
	path: string;
	/** Display name. */
	name: string;
	/** Number of Markdown notes in this folder. */
	noteCount: number;
	/** True if this is the vault root. */
	isRoot: boolean;
}

/**
 * Choose a vault folder (or the vault root) to attach as a source.
 *
 * Only folders that actually hold Markdown are offered, and the note count is
 * shown up front so it is obvious that attaching one sends several notes.
 */
export class FolderPickerModal extends FuzzySuggestModal<FolderSource> {
	private readonly counts = new Map<string, number>();

	constructor(
		app: App,
		private readonly onChoose: (folder: FolderSource) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a folder…');
	}

	getItems(): FolderSource[] {
		const items: FolderSource[] = [];

		// Add vault root as first option
		const rootNotes = this.app.vault.getMarkdownFiles().length;
		if (rootNotes > 0) {
			items.push({
				path: '',
				name: 'Vault root',
				noteCount: rootNotes,
				isRoot: true,
			});
		}

		// Add regular folders
		const folders = listNoteFolders(this.app);
		for (const folder of folders) {
			const count = listFolderNotes(this.app, folder.path).length;
			this.counts.set(folder.path, count);
			items.push({
				path: folder.path,
				name: folderDisplayName(folder.path),
				noteCount: count,
				isRoot: false,
			});
		}
		return items;
	}

	getItemText(item: FolderSource): string {
		return item.name;
	}

	override renderSuggestion(match: { item: FolderSource }, el: HTMLElement): void {
		const item = match.item;
		el.addClass('obsaide-model-suggestion');

		const titleRow = el.createDiv({ cls: 'obsaide-model-title-row' });
		const icon = titleRow.createSpan({ cls: 'obsaide-model-icon' });
		if (item.isRoot) {
			setIcon(icon, 'box');
		} else {
			setIcon(icon, 'folder');
		}
		titleRow.createDiv({
			cls: 'obsaide-model-title',
			text: item.name,
		});

		const meta = el.createDiv({
			cls: 'obsaide-model-meta',
			text: `${item.path || '/'} · ${describeNoteCount(item.noteCount)}`,
		});
		if (item.isRoot) {
			meta.addClass('is-root');
		}
	}

	onChooseItem(item: FolderSource): void {
		this.onChoose(item);
	}
}
