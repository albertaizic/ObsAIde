import { FuzzySuggestModal, type App, type TFile } from 'obsidian';
import { listMarkdownFiles } from '../context/collect';

/** Choose a note from the vault to attach as context. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder('Attach a note as context…');
	}

	getItems(): TFile[] {
		return listMarkdownFiles(this.app);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}
