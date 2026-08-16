import { FuzzySuggestModal, type App, type FuzzyMatch, type TFolder } from 'obsidian';
import { listFolderNotes, listNoteFolders } from '../context/collect';
import { describeNoteCount, folderDisplayName } from '../context/folder';

/**
 * Choose a vault folder to attach.
 *
 * Only folders that actually hold Markdown are offered, and the note count is
 * shown up front so it is obvious that attaching one sends several notes.
 */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	private readonly counts = new Map<string, number>();

	constructor(
		app: App,
		private readonly onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder('Attach a folder of notes…');
	}

	getItems(): TFolder[] {
		const folders = listNoteFolders(this.app);
		for (const folder of folders) {
			this.counts.set(folder.path, listFolderNotes(this.app, folder.path).length);
		}
		return folders;
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	override renderSuggestion(match: FuzzyMatch<TFolder>, el: HTMLElement): void {
		const folder = match.item;
		el.addClass('obsaide-model-suggestion');
		el.createDiv({
			cls: 'obsaide-model-title',
			text: folderDisplayName(folder.path),
		});
		el.createDiv({
			cls: 'obsaide-model-meta',
			text: `${folder.path} · ${describeNoteCount(this.counts.get(folder.path) ?? 0)}`,
		});
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}
