import { Modal, Setting, Notice, type App, type TFile, type TFolder, setIcon } from 'obsidian';
import { FolderPickerModal } from './folder-picker';
import { NotePickerModal } from './note-picker';

export interface WikilinkTarget {
	file: TFile;
	selected: boolean;
}

export interface WikilinkSource {
	file: TFile;
	selected: boolean;
}

export interface WikilinkFolderSource {
	folder: TFolder;
	selected: boolean;
	noteCount: number;
}

export interface WikilinkSetupOptions {
	targets: WikilinkTarget[];
	sources: WikilinkSource[];
	sourceFolders: WikilinkFolderSource[];
}

/** Modal for configuring wikilink analysis: select target notes and source notes/folders. */
export class WikilinkSetupModal extends Modal {
	private readonly onAnalyze: (options: WikilinkSetupOptions) => void;
	private targets: WikilinkTarget[] = [];
	private sources: WikilinkSource[] = [];
	private sourceFolders: WikilinkFolderSource[] = [];
	private analyzeButton!: HTMLButtonElement;

	constructor(app: App, onAnalyze: (options: WikilinkSetupOptions) => void) {
		super(app);
		this.onAnalyze = onAnalyze;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-wikilink-setup-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-header' });
		header.createEl('h3', { text: 'Suggest wikilinks' });

		// Targets section
		const targetsSection = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-section' });
		const targetsHeader = targetsSection.createDiv({ cls: 'obsaide-wikilink-setup-section-header' });
		targetsHeader.createEl('h4', { text: 'Targets' });
		targetsHeader.createEl('span', { cls: 'obsaide-wikilink-setup-section-desc', text: 'Notes that will receive new wikilinks' });

		this.targetsList = targetsSection.createDiv({ cls: 'obsaide-wikilink-setup-list' });
		this.renderTargets();

		const addTargetBtn = targetsSection.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ Add target note',
		});
		addTargetBtn.addEventListener('click', () => this.addTargetNote());

		// Sources section
		const sourcesSection = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-section' });
		const sourcesHeader = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-section-header' });
		sourcesHeader.createEl('h4', { text: 'Sources' });
		sourcesHeader.createEl('span', { cls: 'obsaide-wikilink-setup-section-desc', text: 'Notes/folders to analyze for connections (will not be modified)' });

		this.sourcesList = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-list' });
		this.renderSources();

		const sourceButtons = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-buttons' });
		const addSourceNoteBtn = sourceButtons.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ Add source note',
		});
		addSourceNoteBtn.addEventListener('click', () => this.addSourceNote());

		const addSourceFolderBtn = sourceButtons.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ Add source folder',
		});
		addSourceFolderBtn.addEventListener('click', () => this.addSourceFolder());

		// Analyze button
		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		this.analyzeButton = buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Analyze connections',
		});
		this.analyzeButton.addEventListener('click', () => this.handleAnalyze());
		this.updateAnalyzeButton();

		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => this.close());
	}

	private targetsList!: HTMLElement;
	private sourcesList!: HTMLElement;

	private renderTargets(): void {
		this.targetsList.empty();

		if (this.targets.length === 0) {
			this.targetsList.createDiv({
				cls: 'obsaide-wikilink-setup-empty',
				text: 'No target notes selected. At least one target is required.',
			});
			return;
		}

		for (let i = 0; i < this.targets.length; i++) {
			const target = this.targets[i]!;
			const item = this.targetsList.createDiv({ cls: 'obsaide-wikilink-setup-item' });

			const checkbox = item.createEl('input', {
				type: 'checkbox',
				cls: 'obsaide-wikilink-setup-checkbox',
			});
			checkbox.checked = target.selected;
			checkbox.addEventListener('change', () => {
				target.selected = checkbox.checked;
				this.updateAnalyzeButton();
			});

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			info.createDiv({ cls: 'obsaide-wikilink-setup-title', text: target.file.basename });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: target.file.path });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${target.file.basename}` },
			});
			setIcon(removeBtn, 'trash-2');
			removeBtn.addEventListener('click', () => {
				this.targets.splice(i, 1);
				this.renderTargets();
				this.updateAnalyzeButton();
			});
		}
	}

	private renderSources(): void {
		this.sourcesList.empty();

		const totalSources = this.sources.length + this.sourceFolders.length;
		if (totalSources === 0) {
			this.sourcesList.createDiv({
				cls: 'obsaide-wikilink-setup-empty',
				text: 'No sources selected. Add source notes or folders to analyze.',
			});
			return;
		}

		// Source notes
		for (let i = 0; i < this.sources.length; i++) {
			const source = this.sources[i]!;
			const item = this.sourcesList.createDiv({ cls: 'obsaide-wikilink-setup-item' });

			const checkbox = item.createEl('input', {
				type: 'checkbox',
				cls: 'obsaide-wikilink-setup-checkbox',
			});
			checkbox.checked = source.selected;
			checkbox.addEventListener('change', () => {
				source.selected = checkbox.checked;
			});

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			const titleRow = info.createDiv({ cls: 'obsaide-wikilink-setup-title-row' });
			titleRow.createDiv({ cls: 'obsaide-wikilink-setup-title', text: source.file.basename });
			titleRow.createSpan({ cls: 'obsaide-wikilink-setup-badge', text: 'Note' });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: source.file.path });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${source.file.basename}` },
			});
			setIcon(removeBtn, 'trash-2');
			removeBtn.addEventListener('click', () => {
				this.sources.splice(i, 1);
				this.renderSources();
				this.updateAnalyzeButton();
			});
		}

		// Source folders
		for (let i = 0; i < this.sourceFolders.length; i++) {
			const folder = this.sourceFolders[i]!;
			const item = this.sourcesList.createDiv({ cls: 'obsaide-wikilink-setup-item' });

			const checkbox = item.createEl('input', {
				type: 'checkbox',
				cls: 'obsaide-wikilink-setup-checkbox',
			});
			checkbox.checked = folder.selected;
			checkbox.addEventListener('change', () => {
				folder.selected = checkbox.checked;
			});

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			const titleRow = info.createDiv({ cls: 'obsaide-wikilink-setup-title-row' });
			titleRow.createDiv({ cls: 'obsaide-wikilink-setup-title', text: folder.folder.name });
			titleRow.createSpan({ cls: 'obsaide-wikilink-setup-badge', text: `Folder (${folder.noteCount} notes)` });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: folder.folder.path });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${folder.folder.name}` },
			});
			setIcon(removeBtn, 'trash-2');
			removeBtn.addEventListener('click', () => {
				this.sourceFolders.splice(i, 1);
				this.renderSources();
				this.updateAnalyzeButton();
			});
		}
	}

	private addTargetNote(): void {
		new NotePickerModal(this.app, (file) => {
			if (this.targets.some(t => t.file.path === file.path)) {
				new Notice('This note is already a target.');
				return;
			}
			this.targets.push({ file, selected: true });
			this.renderTargets();
			this.updateAnalyzeButton();
		}).open();
	}

	private addSourceNote(): void {
		new NotePickerModal(this.app, (file) => {
			// Check if already a target
			if (this.targets.some(t => t.file.path === file.path)) {
				new Notice('This note is already a target. It cannot also be a source.');
				return;
			}
			if (this.sources.some(s => s.file.path === file.path)) {
				new Notice('This note is already a source.');
				return;
			}
			this.sources.push({ file, selected: true });
			this.renderSources();
		}).open();
	}

	private addSourceFolder(): void {
		new FolderPickerModal(this.app, (folder) => {
			// Count notes in folder
			const notes = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder.path + '/') || f.path === folder.path);
			if (notes.length === 0) {
				new Notice('This folder contains no Markdown notes.');
				return;
			}
			if (this.sourceFolders.some(f => f.folder.path === folder.path)) {
				new Notice('This folder is already a source.');
				return;
			}
			this.sourceFolders.push({ folder, selected: true, noteCount: notes.length });
			this.renderSources();
			this.updateAnalyzeButton();
		}).open();
	}

	private updateAnalyzeButton(): void {
		const hasTarget = this.targets.some(t => t.selected);
		const hasSource = this.sources.some(s => s.selected) || this.sourceFolders.some(f => f.selected);
		this.analyzeButton.disabled = !(hasTarget && hasSource);
	}

	private handleAnalyze(): void {
		this.close();
		this.onAnalyze({
			targets: this.targets,
			sources: this.sources,
			sourceFolders: this.sourceFolders,
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}