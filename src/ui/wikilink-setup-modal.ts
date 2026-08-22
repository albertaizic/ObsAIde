import { Modal, Notice, type App, type TFile, TFolder, setIcon } from 'obsidian';
import { FolderPickerModal, FolderSource } from './folder-picker';
import { NotePickerModal } from './note-picker';

export interface WikilinkTarget {
	file: TFile;
}

export interface WikilinkSource {
	file: TFile;
}

export interface WikilinkFolderSource {
	folder: TFolder | null;
	noteCount: number;
	isRoot?: boolean;
}

export interface WikilinkSetupOptions {
	targets: WikilinkTarget[];
	sources: WikilinkSource[];
	sourceFolders: WikilinkFolderSource[];
}

/** Analysis state for the wikilink modal. */
type AnalysisState = 'idle' | 'analyzing' | 'cancelled';

/** Modal for configuring wikilink analysis: select target notes and source notes/folders. */
export class WikilinkSetupModal extends Modal {
	private readonly onAnalyze: (options: WikilinkSetupOptions, signal: AbortSignal) => void;
	private targets: WikilinkTarget[] = [];
	private sources: WikilinkSource[] = [];
	private sourceFolders: WikilinkFolderSource[] = [];
	private analyzeButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private state: AnalysisState = 'idle';
	private abortController: AbortController | null = null;
	private headerTitleEl!: HTMLElement;
	private targetsList!: HTMLElement;
	private sourcesList!: HTMLElement;
	private stateDisplayEl!: HTMLElement;

	constructor(app: App, onAnalyze: (options: WikilinkSetupOptions, signal: AbortSignal) => void) {
		super(app);
		this.onAnalyze = onAnalyze;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-wikilink-setup-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-header' });
		this.headerTitleEl = header.createEl('h3', { text: 'Suggest wikilinks' });

		// Targets section
		const targetsSection = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-section' });
		const targetsHeader = targetsSection.createDiv({ cls: 'obsaide-wikilink-setup-section-header' });
		targetsHeader.createEl('h4', { text: 'Target notes' });
		targetsHeader.createSpan({ cls: 'obsaide-wikilink-setup-section-desc', text: 'Notes that will receive new wikilinks' });

		this.targetsList = targetsSection.createDiv({ cls: 'obsaide-wikilink-setup-list' });
		this.renderTargets();

		const addTargetBtn = targetsSection.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ add target note',
		});
		addTargetBtn.addEventListener('click', () => this.addTargetNote());

		// Sources section
		const sourcesSection = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-section' });
		const sourcesHeader = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-section-header' });
		sourcesHeader.createEl('h4', { text: 'Source material' });
		sourcesHeader.createSpan({ cls: 'obsaide-wikilink-setup-section-desc', text: 'Notes and folders to analyze for connections (will not be modified)' });

		this.sourcesList = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-list' });
		this.renderSources();

		const addSourceNoteBtn = sourcesSection.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ add source note',
		});
		addSourceNoteBtn.addEventListener('click', () => this.addSourceNote());

		const addSourceFolderBtn = sourcesSection.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ add source folder',
		});
		addSourceFolderBtn.addEventListener('click', () => this.addSourceFolder());

		// Action buttons
		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		this.cancelButton = buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		});
		this.cancelButton.addEventListener('click', () => this.handleCancel());

		this.analyzeButton = buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Analyze connections',
		});
		this.analyzeButton.addEventListener('click', () => this.handleAnalyze());

		this.updateUIForState();
	}

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

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			info.createDiv({ cls: 'obsaide-wikilink-setup-title', text: target.file.basename });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: target.file.path });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${target.file.basename}` },
			});
			setIcon(removeBtn, 'x');
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

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			const titleRow = info.createDiv({ cls: 'obsaide-wikilink-setup-title-row' });
			const icon = titleRow.createSpan({ cls: 'obsaide-wikilink-setup-icon' });
			setIcon(icon, 'file-text');
			titleRow.createDiv({ cls: 'obsaide-wikilink-setup-title', text: source.file.basename });
			titleRow.createSpan({ cls: 'obsaide-wikilink-setup-badge', text: 'Note' });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: source.file.path });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${source.file.basename}` },
			});
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', () => {
				this.sources.splice(i, 1);
				this.renderSources();
				this.updateAnalyzeButton();
			});
		}

		// Source folders (including vault root)
		for (let i = 0; i < this.sourceFolders.length; i++) {
			const folder = this.sourceFolders[i]!;
			const isRoot = folder.isRoot === true;
			const item = this.sourcesList.createDiv({ cls: 'obsaide-wikilink-setup-item' });

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			const titleRow = info.createDiv({ cls: 'obsaide-wikilink-setup-title-row' });
			const icon = titleRow.createSpan({ cls: 'obsaide-wikilink-setup-icon' });
			setIcon(icon, isRoot ? 'box' : 'folder');
			let folderName: string;
			let folderPath: string;
			if (isRoot) {
				folderName = 'Vault root';
				folderPath = '/';
			} else {
				folderName = folder.folder?.name ?? 'Unknown folder';
				folderPath = folder.folder?.path ?? 'Unknown path';
			}
			titleRow.createDiv({ cls: 'obsaide-wikilink-setup-title', text: folderName });
			titleRow.createSpan({ cls: 'obsaide-wikilink-setup-badge', text: isRoot ? `Vault (${folder.noteCount} notes)` : `Folder (${folder.noteCount} notes)` });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: folderPath });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${folderName}` },
			});
			setIcon(removeBtn, 'x');
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
			this.targets.push({ file });
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
			this.sources.push({ file });
			this.renderSources();
		}).open();
	}

	private addSourceFolder(): void {
		new FolderPickerModal(this.app, (folderSource: FolderSource) => {
			if (folderSource.isRoot) {
				if (this.sourceFolders.some(f => (f as WikilinkFolderSource & { isRoot?: boolean }).isRoot)) {
					new Notice('Vault root is already a source.');
					return;
				}
				const noteCount = this.app.vault.getMarkdownFiles().length;
				const rootEntry: WikilinkFolderSource = { folder: null, noteCount, isRoot: true };
				this.sourceFolders.push(rootEntry);
			} else {
				if (this.sourceFolders.some(f => f.folder?.path === folderSource.path)) {
					new Notice('This folder is already a source.');
					return;
				}
				const resolved = this.app.vault.getAbstractFileByPath(folderSource.path);
				if (resolved instanceof TFolder) {
					this.sourceFolders.push({ folder: resolved, noteCount: folderSource.noteCount });
				}
			}
			this.renderSources();
			this.updateAnalyzeButton();
		}).open();
	}

	private updateAnalyzeButton(): void {
		const hasTarget = this.targets.length > 0;
		const hasSource = this.sources.length > 0 || this.sourceFolders.length > 0;
		this.analyzeButton.disabled = !(hasTarget && hasSource);
	}

	private handleAnalyze(): void {
		this.setState('analyzing');
		this.abortController = new AbortController();
		this.onAnalyze({
			targets: this.targets,
			sources: this.sources,
			sourceFolders: this.sourceFolders,
		}, this.abortController.signal);
	}

	private handleCancel(): void {
		if (this.state === 'analyzing') {
			this.setState('cancelled');
			this.abortController?.abort();
			window.setTimeout(() => {
				this.setState('idle');
			}, 100);
		} else {
			this.close();
		}
	}

	private setState(state: AnalysisState): void {
		this.state = state;
		this.updateUIForState();
	}

	private updateUIForState(): void {
		const isAnalyzing = this.state === 'analyzing';

		// Update title
		if (isAnalyzing) {
			this.headerTitleEl.setText('Analyzing connections…');
		} else if (this.state === 'cancelled') {
			this.headerTitleEl.setText('Analysis cancelled');
		} else {
			this.headerTitleEl.setText('Suggest wikilinks');
		}

		// Show/hide state display
		if (!this.stateDisplayEl) {
			this.stateDisplayEl = this.contentEl.createDiv({ cls: 'obsaide-wikilink-setup-state' });
		}

		if (isAnalyzing) {
			this.stateDisplayEl.removeClass('is-hidden');
			this.stateDisplayEl.empty();
			this.stateDisplayEl.createDiv({ cls: 'obsaide-spinner' });
			this.stateDisplayEl.createSpan({ text: 'Aide is comparing the target content with the selected source material and looking for meaningful connections.' });
		} else if (this.state === 'cancelled') {
			this.stateDisplayEl.removeClass('is-hidden');
			this.stateDisplayEl.empty();
			this.stateDisplayEl.createSpan({ text: 'Analysis cancelled.', cls: 'obsaide-wikilink-cancelled-text' });
			window.setTimeout(() => {
				if (this.stateDisplayEl) this.stateDisplayEl.addClass('is-hidden');
			}, 1500);
		} else {
			this.stateDisplayEl.addClass('is-hidden');
		}

		// Update buttons
		this.analyzeButton.disabled = this.state !== 'idle';
		this.analyzeButton.setText(this.state === 'analyzing' ? 'Analyzing…' : 'Analyze connections');

		// Cancel button text
		this.cancelButton.setText(this.state === 'analyzing' ? 'Cancel analysis' : 'Cancel');

		// Disable inputs during analysis
		const inputs = this.contentEl.querySelectorAll('input, button:not(.obsaide-modal-footer button)');
		inputs.forEach(el => {
			(el as HTMLInputElement | HTMLButtonElement).disabled = this.state === 'analyzing';
		});
	}

	override onClose(): void {
		if (this.state === 'analyzing') {
			this.abortController?.abort();
		}
		this.contentEl.empty();
	}
}