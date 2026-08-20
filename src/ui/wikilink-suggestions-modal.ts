import { Modal, type App, type TFile } from 'obsidian';
import { type WikilinkSuggestion } from '../context/wikilink-suggestions';

/** Options for the wikilink suggestions modal. */
export interface WikilinkSuggestionsModalOptions {
	/** The source text to apply suggestions to. */
	sourceText: string;
	/** The file being edited (for saving). */
	file: TFile;
	/** Callback when suggestions are applied. */
	onApply: (newText: string) => void;
}

/** Modal for reviewing and applying wikilink suggestions. */
export class WikilinkSuggestionsModal extends Modal {
	private readonly sourceText: string;
	private readonly file: TFile;
	private readonly onApply: (newText: string) => void;
	private suggestions: WikilinkSuggestion[] = [];
	private selected = new Set<number>();
	private pendingSuggestions: WikilinkSuggestion[] | null = null;

	constructor(app: App, options: WikilinkSuggestionsModalOptions) {
		super(app);
		this.sourceText = options.sourceText;
		this.file = options.file;
		this.onApply = options.onApply;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-wikilink-suggestions-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'obsaide-wikilink-header' });
		header.createEl('h3', { text: 'Suggested wikilinks' });

		// Suggestions list
		this.listContainer = contentEl.createDiv({ cls: 'obsaide-wikilink-list' });

		// Footer with actions
		const footer = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		const applyButton = footer.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Apply selected',
		});
		applyButton.addEventListener('click', () => this.applySelected());
		applyButton.disabled = true;
		this.applyButton = applyButton;

		footer.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => this.close());

		// Render any pending suggestions that were set before onOpen
		if (this.pendingSuggestions !== null) {
			this.suggestions = this.pendingSuggestions;
			this.pendingSuggestions = null;
			this.renderList();
		}
	}

	/** Show a loading state while suggestions are being generated. */
	showLoading(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();
		const loading = this.listContainer.createDiv({ cls: 'obsaide-wikilink-loading' });
		loading.createDiv({ cls: 'obsaide-spinner' });
		loading.createSpan({ text: 'Finding wikilinks…' });
		this.applyButton.disabled = true;
	}

	private listContainer!: HTMLElement;
	private applyButton!: HTMLButtonElement;

	setSuggestions(suggestions: WikilinkSuggestion[]): void {
		this.suggestions = suggestions;
		this.selected.clear();
		// If modal is already open, render immediately; otherwise store for onOpen
		if (this.listContainer) {
			this.renderList();
		} else {
			this.pendingSuggestions = suggestions;
		}
	}

	private renderList(): void {
		this.listContainer.empty();

		if (this.suggestions.length === 0) {
			this.listContainer.createDiv({
				cls: 'obsaide-wikilink-empty',
				text: 'No wikilink suggestions found for this text.',
			});
			this.applyButton.disabled = true;
			return;
		}

		for (let i = 0; i < this.suggestions.length; i++) {
			const suggestion = this.suggestions[i];
			if (!suggestion) continue;

			const item = this.listContainer.createDiv({ cls: 'obsaide-wikilink-item' });
			item.dataset.index = String(i);

			// Checkbox
			const checkbox = item.createEl('input', {
				type: 'checkbox',
				cls: 'obsaide-wikilink-checkbox',
			});
			checkbox.checked = this.selected.has(i);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selected.add(i);
				else this.selected.delete(i);
				this.updateApplyButton();
			});

			// Content
			const content = item.createDiv({ cls: 'obsaide-wikilink-content' });

			const titleRow = content.createDiv({ cls: 'obsaide-wikilink-title-row' });
			titleRow.createSpan({ cls: 'obsaide-wikilink-target', text: suggestion.targetTitle });
			titleRow.createSpan({ cls: 'obsaide-wikilink-path', text: suggestion.targetPath });

			content.createDiv({
				cls: 'obsaide-wikilink-phrase',
				text: `Phrase: "${suggestion.sourcePhrase}"`,
			});

			content.createDiv({
				cls: 'obsaide-wikilink-reason',
				text: suggestion.reason,
			});

			// Click on item toggles selection
			item.addEventListener('click', (e) => {
				if (e.target === checkbox) return;
				checkbox.checked = !checkbox.checked;
				checkbox.dispatchEvent(new Event('change'));
			});
		}
	}

	private updateApplyButton(): void {
		this.applyButton.disabled = this.selected.size === 0;
		this.applyButton.setText(
			this.selected.size === 0 ? 'Apply selected' : `Apply ${this.selected.size} selected`,
		);
	}

	private applySelected(): void {
		if (this.selected.size === 0) return;

		let newText = this.sourceText;
		// Sort by position in text (descending) to apply from end to start
		const sortedIndices = Array.from(this.selected).sort((a, b) => {
			const suggestionA = this.suggestions[a];
			const suggestionB = this.suggestions[b];
			if (!suggestionA || !suggestionB) return 0;
			const posA = newText.toLowerCase().indexOf(suggestionA.sourcePhrase.toLowerCase());
			const posB = newText.toLowerCase().indexOf(suggestionB.sourcePhrase.toLowerCase());
			return posB - posA;
		});

		for (const index of sortedIndices) {
			const suggestion = this.suggestions[index];
			if (suggestion) {
				if (suggestion.replacement) {
					// Use custom replacement (AI-suggested rewrite)
					const idx = newText.toLowerCase().indexOf(suggestion.sourcePhrase.toLowerCase());
					if (idx !== -1 && !isPositionProtected(newText, idx)) {
						newText = newText.slice(0, idx) + suggestion.replacement + newText.slice(idx + suggestion.sourcePhrase.length);
					}
				} else {
					newText = applyWikilinkToText(newText, suggestion.sourcePhrase, suggestion.targetTitle);
				}
			}
		}

		this.close();
		this.onApply(newText);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Apply a wikilink to text, handling protected regions. */
function applyWikilinkToText(text: string, sourcePhrase: string, targetTitle: string): string {
	const index = text.toLowerCase().indexOf(sourcePhrase.toLowerCase());
	if (index === -1) return text;

	// Check if position is protected
	if (isPositionProtected(text, index)) return text;

	// Use simple wikilink if phrase matches title case-insensitively
	const matchesIgnoreCase = sourcePhrase.toLowerCase() === targetTitle.toLowerCase();
	const linkText = matchesIgnoreCase
		? `[[${targetTitle}]]`
		: `[[${targetTitle}|${sourcePhrase}]]`;

	return text.slice(0, index) + linkText + text.slice(index + sourcePhrase.length);
}

/** Check if a position in text is inside a protected region. */
function isPositionProtected(text: string, index: number): boolean {
	// Check if inside code block
	const beforeText = text.slice(0, index);
	const codeBlockCount = (beforeText.match(/```/g) || []).length;
	if (codeBlockCount % 2 === 1) return true;

	// Check if inside inline code
	const inlineCodeCount = (beforeText.match(/`/g) || []).length;
	if (inlineCodeCount % 2 === 1) return true;

	// Check if inside frontmatter
	const firstDelimiter = text.indexOf('---');
	const secondDelimiter = text.indexOf('---', firstDelimiter + 3);
	if (firstDelimiter === 0 && secondDelimiter !== -1 && index > firstDelimiter && index < secondDelimiter) {
		return true;
	}

	// Check if already inside a wikilink
	const wikilinkStart = beforeText.lastIndexOf('[[');
	const wikilinkEnd = beforeText.lastIndexOf(']]');
	if (wikilinkStart !== -1 && (wikilinkEnd === -1 || wikilinkStart > wikilinkEnd)) {
		return true;
	}

	// Check if inside markdown link [text](url)
	const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
	let linkMatch;
	while ((linkMatch = linkRegex.exec(text)) !== null) {
		const linkStart = linkMatch.index;
		const linkEnd = linkMatch.index + linkMatch[0].length;
		if (index >= linkStart && index <= linkEnd) {
			return true;
		}
	}

	return false;
}