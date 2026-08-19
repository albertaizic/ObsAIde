import { Modal, Notice, setIcon, type App, TFile } from 'obsidian';
import { VaultSearchResult, searchVault } from '../context/vault-search';
import { captureNote } from '../context/collect';
import type { Attachment } from '../context/types';

export interface VaultSearchModalOptions {
	onSelect: (attachments: Attachment[]) => void;
}

/** Modal for searching the vault and selecting notes to attach as context. */
export class VaultSearchModal extends Modal {
	private query = '';
	private results: VaultSearchResult[] = [];
	private selected = new Set<string>();
	private resultListEl!: HTMLElement;
	private searchInputEl!: HTMLInputElement;
	private statusEl!: HTMLElement;
	private debounceTimer: number | null = null;

	constructor(
		app: App,
		private readonly options: VaultSearchModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-vault-search-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'obsaide-vault-search-header' });
		header.createEl('h3', { text: 'Vault search' });

		// Search input
		const inputContainer = contentEl.createDiv({ cls: 'obsaide-vault-search-input-container' });
		const searchIcon = inputContainer.createSpan({ cls: 'obsaide-vault-search-icon' });
		setIcon(searchIcon, 'search');
		this.searchInputEl = inputContainer.createEl('input', {
			type: 'text',
			cls: 'obsaide-vault-search-input',
			attr: { placeholder: 'Search notes... (E.g., "dijkstra shortest path")' },
		});
		this.searchInputEl.addEventListener('input', () => this.onQueryChange());
		this.searchInputEl.addEventListener('keydown', (e) => this.onKeyDown(e));

		// Status
		this.statusEl = contentEl.createDiv({ cls: 'obsaide-vault-search-status' });

		// Results list
		this.resultListEl = contentEl.createDiv({ cls: 'obsaide-vault-search-results' });

		// Footer with actions
		const footer = contentEl.createDiv({ cls: 'obsaide-vault-search-footer' });
		const addButton = footer.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Add selected',
		});
		addButton.addEventListener('click', () => void this.addSelected());
		addButton.disabled = true;
		this.addButton = addButton;

		const cancelButton = footer.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		});
		cancelButton.addEventListener('click', () => this.close());

		// Focus input
		this.searchInputEl.focus();
	}

	private addButton!: HTMLButtonElement;

	private onQueryChange(): void {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.query = this.searchInputEl.value.trim();
			void this.performSearch();
		}, 150);
	}

	private async performSearch(): Promise<void> {
		this.statusEl.setText('Searching…');
		this.resultListEl.empty();
		this.selected.clear();
		this.updateAddButton();

		if (!this.query) {
			this.statusEl.setText('Enter a search query');
			return;
		}

		try {
			this.results = await searchVault(this.app, this.query);
			this.renderResults();
			this.statusEl.setText(
				this.results.length === 0
					? 'No notes found'
					: `${this.results.length} note${this.results.length === 1 ? '' : 's'} found`,
			);
		} catch (error) {
			this.statusEl.setText('Search failed');
			new Notice('Vault search failed: ' + String(error));
		}
	}

	private renderResults(): void {
		this.resultListEl.empty();

		if (this.results.length === 0) {
			this.resultListEl.createDiv({
				cls: 'obsaide-vault-search-empty',
				text: 'No notes match your query',
			});
			return;
		}

		for (const result of this.results) {
			const item = this.resultListEl.createDiv({ cls: 'obsaide-vault-search-item' });
			item.dataset.path = result.path;

			// Checkbox
			const checkbox = item.createEl('input', {
				type: 'checkbox',
				cls: 'obsaide-vault-search-checkbox',
			});
			checkbox.checked = this.selected.has(result.path);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selected.add(result.path);
				else this.selected.delete(result.path);
				this.updateAddButton();
			});

			// Content
			const content = item.createDiv({ cls: 'obsaide-vault-search-content' });

			const titleRow = content.createDiv({ cls: 'obsaide-vault-search-title-row' });
			titleRow.createSpan({ cls: 'obsaide-vault-search-title', text: result.title });
			titleRow.createSpan({ cls: 'obsaide-vault-search-path', text: result.path });

			if (result.matchedHeading) {
				content.createDiv({
					cls: 'obsaide-vault-search-heading',
					text: `→ ${result.matchedHeading}`,
				});
			}

			content.createDiv({
				cls: 'obsaide-vault-search-snippet',
				text: result.snippet,
			});

			// Click on item toggles selection
			item.addEventListener('click', (e) => {
				if (e.target === checkbox) return;
				checkbox.checked = !checkbox.checked;
				checkbox.dispatchEvent(new Event('change'));
			});
		}
	}

	private updateAddButton(): void {
		this.addButton.disabled = this.selected.size === 0;
		this.addButton.setText(
			this.selected.size === 0 ? 'Add selected' : `Add ${this.selected.size} selected`,
		);
	}

	private async addSelected(): Promise<void> {
		if (this.selected.size === 0) return;

		const attachments: Attachment[] = [];
		for (const path of this.selected) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				attachments.push(captureNote(file));
			}
		}

		this.close();
		this.options.onSelect(attachments);
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			this.close();
		} else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			if (this.selected.size > 0) void this.addSelected();
		}
	}

	override onClose(): void {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.contentEl.empty();
	}
}

/** Re-export for convenience */
export { searchVault, clearSearchIndex, type VaultSearchResult } from '../context/vault-search';