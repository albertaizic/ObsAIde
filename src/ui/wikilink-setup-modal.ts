import { Modal, Notice, setTooltip, type App, type TFile, TFolder, setIcon } from 'obsidian';
import { describeNoteCount, normalizeFolderPath } from '../context/folder';
import {
	canAnalyzeWikilinks,
	type WikilinkProposal,
} from '../context/wikilink-suggestions';
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

/** One target's outcome: its proposals are already parsed and filtered. */
export interface WikilinkTargetResult {
	targetFile: TFile;
	proposals: WikilinkProposal[];
}

/** Real operation stages, reported while work is actually happening. */
export type WikilinkStage = 'preparing' | 'analyzing' | 'reviewing';

const STAGE_LABELS: Record<WikilinkStage, string> = {
	preparing: 'Preparing source material…',
	analyzing: 'Analyzing with Aide…',
	reviewing: 'Preparing proposed changes…',
};

export interface WikilinkSetupCallbacks {
	/**
	 * Run the whole analysis. Must observe the signal and report real stages;
	 * resolves with per-target proposals (possibly empty).
	 */
	analyze: (
		options: WikilinkSetupOptions,
		signal: AbortSignal,
		onStage: (stage: WikilinkStage) => void,
	) => Promise<WikilinkTargetResult[]>;
	/** Open the existing diff review for one target's proposals. */
	onReview: (result: WikilinkTargetResult) => void;
}

type ModalState = 'idle' | 'running' | 'results' | 'error';

/**
 * The whole wikilink workflow in one modal: pick targets and sources, watch
 * the real analysis stages, and land on a visible result — success, zero
 * connections or failure — without the modal ever closing underneath you.
 *
 * Only the Analyze button starts work; changing the selection never does.
 * While running, the selection is frozen and Cancel aborts; a late result
 * from a cancelled run is discarded by run token and state guard.
 */
export class WikilinkSetupModal extends Modal {
	private readonly callbacks: WikilinkSetupCallbacks;
	private targets: WikilinkTarget[] = [];
	private sources: WikilinkSource[] = [];
	private sourceFolders: WikilinkFolderSource[] = [];
	private state: ModalState = 'idle';
	private stage: WikilinkStage = 'preparing';
	private results: WikilinkTargetResult[] = [];
	private errorMessage = '';
	private abortController: AbortController | null = null;
	private runToken = 0;

	constructor(app: App, callbacks: WikilinkSetupCallbacks) {
		super(app);
		this.callbacks = callbacks;
	}

	override onOpen(): void {
		this.contentEl.addClass('obsaide-wikilink-setup-modal');
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		switch (this.state) {
			case 'idle':
				this.renderSetup();
				break;
			case 'running':
				this.renderRunning();
				break;
			case 'results':
				this.renderResults();
				break;
			case 'error':
				this.renderError();
				break;
		}
	}

	// --- setup ----------------------------------------------------------------

	private renderSetup(): void {
		const { contentEl } = this;
		this.setTitle('Suggest wikilinks');

		const targetsSection = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-section' });
		const targetsHeader = targetsSection.createDiv({ cls: 'obsaide-wikilink-setup-section-header' });
		targetsHeader.createEl('h4', { text: 'Target notes' });
		targetsHeader.createSpan({ cls: 'obsaide-wikilink-setup-section-desc', text: 'Notes that will receive new wikilinks' });

		const targetsList = targetsSection.createDiv({ cls: 'obsaide-wikilink-setup-list' });
		this.renderTargets(targetsList);

		const addTargetBtn = targetsSection.createEl('button', {
			cls: 'obsaide-button obsaide-button-small',
			text: '+ add target note',
		});
		addTargetBtn.addEventListener('click', () => this.addTargetNote());

		const sourcesSection = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-section' });
		const sourcesHeader = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-section-header' });
		sourcesHeader.createEl('h4', { text: 'Source material' });
		sourcesHeader.createSpan({ cls: 'obsaide-wikilink-setup-section-desc', text: 'Notes and folders to analyze for connections (will not be modified)' });

		const sourcesList = sourcesSection.createDiv({ cls: 'obsaide-wikilink-setup-list' });
		this.renderSources(sourcesList);

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

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const cancelButton = buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		});
		cancelButton.addEventListener('click', () => this.close());

		const analyzeButton = buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Analyze connections',
		});
		analyzeButton.addEventListener('click', () => this.handleAnalyze());
		// One rule for everyone: the shared validity helper decides.
		analyzeButton.disabled = !canAnalyzeWikilinks({
			targetCount: this.targets.length,
			sourceNoteCount: this.sources.length,
			sourceFolderCount: this.sourceFolders.length,
		});
		if (analyzeButton.disabled) {
			setTooltip(analyzeButton, 'Add at least one target note and one source');
		}
	}

	private renderTargets(list: HTMLElement): void {
		if (this.targets.length === 0) {
			list.createDiv({
				cls: 'obsaide-wikilink-setup-empty',
				text: 'No target notes selected. At least one target is required.',
			});
			return;
		}

		for (let i = 0; i < this.targets.length; i++) {
			const target = this.targets[i]!;
			const item = list.createDiv({ cls: 'obsaide-wikilink-setup-item' });

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
				this.render();
			});
		}
	}

	private renderSources(list: HTMLElement): void {
		if (this.sources.length === 0 && this.sourceFolders.length === 0) {
			list.createDiv({
				cls: 'obsaide-wikilink-setup-empty',
				text: 'No sources selected. A source note alone is enough.',
			});
			return;
		}

		// Source notes: one primary label, one muted metadata line, one remove.
		for (let i = 0; i < this.sources.length; i++) {
			const source = this.sources[i]!;
			const item = list.createDiv({ cls: 'obsaide-wikilink-setup-item' });

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			const titleRow = info.createDiv({ cls: 'obsaide-wikilink-setup-title-row' });
			const icon = titleRow.createSpan({ cls: 'obsaide-wikilink-setup-icon' });
			setIcon(icon, 'file-text');
			titleRow.createDiv({ cls: 'obsaide-wikilink-setup-title', text: source.file.basename });
			info.createDiv({ cls: 'obsaide-wikilink-setup-path', text: source.file.path });

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${source.file.basename}` },
			});
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', () => {
				this.sources.splice(i, 1);
				this.render();
			});
		}

		// Source folders and the vault root, visually distinct from notes.
		for (let i = 0; i < this.sourceFolders.length; i++) {
			const folder = this.sourceFolders[i]!;
			const isRoot = folder.isRoot === true;
			const item = list.createDiv({ cls: 'obsaide-wikilink-setup-item' });

			const info = item.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			const titleRow = info.createDiv({ cls: 'obsaide-wikilink-setup-title-row' });
			const icon = titleRow.createSpan({ cls: 'obsaide-wikilink-setup-icon' });
			setIcon(icon, isRoot ? 'box' : 'folder');
			const name = isRoot ? 'Vault root' : folder.folder?.name ?? 'Unknown folder';
			const path = isRoot ? '/' : folder.folder?.path ?? 'Unknown path';
			titleRow.createDiv({ cls: 'obsaide-wikilink-setup-title', text: name });
			info.createDiv({
				cls: 'obsaide-wikilink-setup-path',
				text: isRoot
					? `${describeNoteCount(folder.noteCount)} · context limits apply`
					: `${describeNoteCount(folder.noteCount)} · ${path}`,
			});

			const removeBtn = item.createEl('button', {
				cls: 'obsaide-wikilink-setup-remove',
				attr: { 'aria-label': `Remove ${name}` },
			});
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', () => {
				this.sourceFolders.splice(i, 1);
				this.render();
			});
		}
	}

	private addTargetNote(): void {
		new NotePickerModal(this.app, (file) => {
			if (this.targets.some(t => t.file.path === file.path)) {
				this.notice('This note is already a target.');
				return;
			}
			// A note about to become a target cannot stay a source: its content
			// reaches the model through the target role only.
			const sourceIndex = this.sources.findIndex(s => s.file.path === file.path);
			if (sourceIndex !== -1) this.sources.splice(sourceIndex, 1);
			this.targets.push({ file });
			this.render();
		}).open();
	}

	private addSourceNote(): void {
		new NotePickerModal(this.app, (file) => {
			if (this.targets.some(t => t.file.path === file.path)) {
				this.notice('This note is already a target. It cannot also be a source.');
				return;
			}
			if (this.sources.some(s => s.file.path === file.path)) {
				this.notice('This note is already a source.');
				return;
			}
			this.sources.push({ file });
			this.render();
		}).open();
	}

	private addSourceFolder(): void {
		new FolderPickerModal(this.app, (folderSource: FolderSource) => {
			const key = normalizeFolderPath(folderSource.path);
			if (this.sourceFolders.some(f => normalizeFolderPath(f.folder?.path ?? (f.isRoot ? '/' : '')) === key)) {
				this.notice(key === '' ? 'Vault root is already a source.' : 'This folder is already a source.');
				return;
			}
			if (folderSource.isRoot || key === '') {
				const noteCount = this.app.vault.getMarkdownFiles().length;
				this.sourceFolders.push({ folder: null, noteCount, isRoot: true });
			} else {
				const resolved = this.app.vault.getAbstractFileByPath(folderSource.path);
				if (resolved instanceof TFolder) {
					this.sourceFolders.push({ folder: resolved, noteCount: folderSource.noteCount });
				} else {
					// Renamed or deleted while the picker was open — say so rather
					// than silently dropping the user's selection.
					this.notice('That folder is no longer available.');
				}
			}
			this.render();
		}).open();
	}

	// --- running ----------------------------------------------------------------

	private handleAnalyze(): void {
		// Freeze the request; later edits cannot touch a running analysis.
		const options: WikilinkSetupOptions = {
			targets: [...this.targets],
			sources: [...this.sources],
			sourceFolders: [...this.sourceFolders],
		};
		const token = ++this.runToken;
		const abortController = new AbortController();
		this.abortController = abortController;
		this.stage = 'preparing';
		this.state = 'running';
		this.render();

		void this.callbacks
			.analyze(options, abortController.signal, (stage) => {
				if (this.isLive(token)) {
					this.stage = stage;
					this.updateStageLabel();
				}
			})
			.then((results) => {
				if (!this.isLive(token)) return; // cancelled or superseded
				this.results = results;
				this.state = 'results';
				this.render();
			})
			.catch((error: unknown) => {
				if (!this.isLive(token)) return;
				if (abortController.signal.aborted) {
					this.state = 'idle';
					this.render();
					return;
				}
				this.errorMessage = String(error);
				this.state = 'error';
				this.render();
			});
	}

	/** A run is live only if it is still the newest one and still running. */
	private isLive(token: number): boolean {
		return token === this.runToken && this.state === 'running';
	}

	private renderRunning(): void {
		this.setTitle('Analyzing connections…');
		const { contentEl } = this;

		const status = contentEl.createDiv({ cls: 'obsaide-wikilink-setup-state' });
		status.createDiv({ cls: 'obsaide-spinner' });
		this.stageLabelEl = status.createSpan({
			cls: 'obsaide-wikilink-setup-stage',
			text: STAGE_LABELS[this.stage],
		});

		// What the run is actually working on.
		const summary = contentEl.createDiv({ cls: 'obsaide-wikilink-run-summary' });
		const targetNames = this.targets.map(t => t.file.basename).join(', ');
		const sourceCount = this.sources.length + this.sourceFolders.length;
		summary.createDiv({
			cls: 'obsaide-wikilink-setup-path',
			text: `Targets: ${targetNames}`,
		});
		summary.createDiv({
			cls: 'obsaide-wikilink-setup-path',
			text: `Sources: ${sourceCount} selected`,
		});

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const cancelButton = buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		});
		cancelButton.addEventListener('click', () => this.handleCancel());
	}

	private stageLabelEl!: HTMLElement;

	private updateStageLabel(): void {
		this.stageLabelEl?.setText(STAGE_LABELS[this.stage]);
	}

	private handleCancel(): void {
		// Bump the token first: any in-flight completion is dead on arrival.
		this.runToken++;
		this.abortController?.abort();
		this.abortController = null;
		this.state = 'idle';
		this.render();
	}

	// --- results / error --------------------------------------------------------

	private renderResults(): void {
		this.setTitle('Wikilink connections');
		const { contentEl } = this;

		const total = this.results.reduce((sum, r) => sum + r.proposals.length, 0);
		const summary = contentEl.createDiv({ cls: 'obsaide-wikilink-result-summary' });
		summary.createSpan({
			cls: 'obsaide-wikilink-setup-path',
			text:
				total === 0
					? 'No meaningful wikilink connections found.'
					: `${total} meaningful connection${total === 1 ? '' : 's'} found`,
		});

		const list = contentEl.createDiv({ cls: 'obsaide-wikilink-result-list' });
		for (const result of this.results) {
			const row = list.createDiv({ cls: 'obsaide-wikilink-result-item' });
			const info = row.createDiv({ cls: 'obsaide-wikilink-setup-info' });
			info.createDiv({ cls: 'obsaide-wikilink-setup-title', text: result.targetFile.basename });
			const count = result.proposals.length;
			info.createDiv({
				cls: 'obsaide-wikilink-setup-path',
				text: count === 0 ? 'No connections' : `${count} meaningful connection${count === 1 ? '' : 's'}`,
			});

			const review = row.createEl('button', {
				cls: 'obsaide-button is-small',
				text: 'Review proposed changes',
			});
			review.disabled = count === 0;
			review.addEventListener('click', () => {
				// The diff review opens on top; this modal stays put underneath.
				this.callbacks.onReview(result);
			});
		}

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const back = buttons.createEl('button', { cls: 'obsaide-button', text: 'Back' });
		back.addEventListener('click', () => {
			this.state = 'idle';
			this.render();
		});
		const close = buttons.createEl('button', { cls: 'obsaide-button is-cta', text: 'Close' });
		close.addEventListener('click', () => this.close());
	}

	private renderError(): void {
		this.setTitle('Analysis failed');
		const { contentEl } = this;

		const box = contentEl.createDiv({ cls: 'obsaide-wikilink-error' });
		box.createSpan({
			cls: 'obsaide-wikilink-setup-path',
			text: this.errorMessage || 'The analysis failed for an unknown reason.',
		});

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const back = buttons.createEl('button', { cls: 'obsaide-button', text: 'Back' });
		back.addEventListener('click', () => {
			this.state = 'idle';
			this.render();
		});
		const retry = buttons.createEl('button', { cls: 'obsaide-button is-cta', text: 'Retry' });
		retry.addEventListener('click', () => this.handleAnalyze());
	}

	private notice(message: string): void {
		new Notice(message);
	}

	override onClose(): void {
		// Leaving the modal kills any run for good.
		this.runToken++;
		this.abortController?.abort();
		this.abortController = null;
		this.contentEl.empty();
	}
}
