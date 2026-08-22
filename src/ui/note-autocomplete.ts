import { type App, type TFile, setIcon, setTooltip } from 'obsidian';
import { listMarkdownFiles } from '../context/collect';
import { createId } from '../utils/id';

/** A Markdown note candidate for @-autocomplete. */
export interface NoteCandidate {
	file: TFile;
	/** The path shown to the user (relative to vault root). */
	displayPath: string;
	/** The note's basename. */
	name: string;
}

/** Configuration for the autocomplete. */
export interface NoteAutocompleteConfig {
	/** The app instance for vault access. */
	app: App;
	/** Called when a note is selected. The attachment is added to the composer's attachments. */
	onSelect: (attachment: NoteAttachment) => void;
	/** Called when the autocomplete should close. */
	onClose: () => void;
}

/** Attachment shape for note references (matches the existing Attachment type for notes). */
export interface NoteAttachment {
	id: string;
	kind: 'note';
	path: string;
	title: string;
	role: 'primary' | 'supporting';
}

/** Default role for @note references. */
const DEFAULT_ROLE: NoteAttachment['role'] = 'primary';

/**
 * Find the last `@word` trigger that starts at a word boundary, scanning the
 * text before the cursor. Returns the index of the `@` and the query typed
 * after it, or null when no trigger is active.
 */
export function findTrigger(text: string): { position: number; query: string } | null {
	// Find the last @ that is at word boundary (start of string or after whitespace)
	const matches = [...text.matchAll(/(^|\s)@([^\s@]*)$/g)];
	if (matches.length === 0) return null;

	const lastMatch = matches[matches.length - 1];
	if (!lastMatch) return null;
	const fullMatch = lastMatch[0]; // Includes leading whitespace if any
	const query = lastMatch[2] || ''; // Text after @

	// Position is the index of @ in the full text
	const matchIndex = text.lastIndexOf(fullMatch) + (fullMatch.length - query.length - 1);
	return { position: matchIndex, query };
}

/** Filter note candidates by a case-insensitive path/name substring query. */
export function filterNoteCandidates<T extends { displayPath: string; name: string }>(
	candidates: readonly T[],
	query: string,
): T[] {
	const q = query.toLowerCase().trim();
	if (!q) return [...candidates];
	return candidates.filter(
		(c) => c.displayPath.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
	);
}

/**
 * Inline @note autocomplete for the composer.
 *
 * - Triggered by typing @ at the start of a word
 * - Shows local Markdown files from the vault
 * - Filters by path/name as the user types
 * - Keyboard: Up/Down to navigate, Enter/Tab to select, Escape to close
 * - Selection adds the note as a real attachment (stable path identity)
 * - Does not read note contents during search (only metadata)
 */
export class NoteAutocomplete {
	private readonly config: NoteAutocompleteConfig;
	private readonly container: HTMLElement;
	private readonly listEl: HTMLElement;
	private candidates: NoteCandidate[] = [];
	private filtered: NoteCandidate[] = [];
	private highlightedIndex = -1;
	private isOpen = false;
	private triggerPosition = -1; // Character index in textarea where @ was typed
	private searchQuery = '';
	private existingAttachments: readonly NoteAttachment[] = [];

	constructor(config: NoteAutocompleteConfig) {
		this.config = config;
		this.container = config.app.workspace.containerEl.createDiv({
			cls: 'obsaide-note-autocomplete is-hidden',
		});

		const header = this.container.createDiv({ cls: 'obsaide-autocomplete-header' });
		header.createSpan({ cls: 'obsaide-autocomplete-title', text: 'Attach a note' });
		const closeBtn = header.createEl('button', {
			cls: 'obsaide-autocomplete-close',
			attr: { 'aria-label': 'Close' },
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		this.listEl = this.container.createDiv({ cls: 'obsaide-autocomplete-list' });
	}

	/**
	 * Call on every textarea input to check for @ trigger and update suggestions.
	 * Returns true if the autocomplete is handling the input (e.g., navigation keys).
	 */
	handleInput(textarea: HTMLTextAreaElement, cursorPos: number): boolean {
		const text = textarea.value;
		const beforeCursor = text.slice(0, cursorPos);

		// Check if we're at an @ trigger position
		const triggerMatch = findTrigger(beforeCursor);
		if (triggerMatch) {
			const { position, query } = triggerMatch;
			if (!this.isOpen) {
				this.open(position, query, textarea);
				return true;
			}
			// Already open, update query
			if (query !== this.searchQuery) {
				this.searchQuery = query;
				this.updateFilter();
			}
			return true;
		}

		// If open but no trigger, close
		if (this.isOpen) {
			this.close();
		}
		return false;
	}

	/** Handle keydown events when autocomplete is open. */
	handleKeyDown(event: KeyboardEvent): boolean {
		if (!this.isOpen) return false;

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				this.highlightNext();
				return true;
			case 'ArrowUp':
				event.preventDefault();
				this.highlightPrevious();
				return true;
			case 'Enter':
			case 'Tab':
				if (this.highlightedIndex >= 0) {
					event.preventDefault();
					this.selectHighlighted();
					return true;
				}
				return false; // Let Enter send the message if nothing highlighted
			case 'Escape':
				event.preventDefault();
				this.close();
				return true;
			default:
				return false;
		}
	}

	/** Open the autocomplete at the given position. */
	private open(triggerPos: number, query: string, textarea: HTMLTextAreaElement): void {
		this.triggerPosition = triggerPos;
		this.searchQuery = query;
		this.isOpen = true;
		this.highlightedIndex = -1;

		// Load all Markdown files once
		if (this.candidates.length === 0) {
			this.loadCandidates();
		}
		this.updateFilter();

		// Position the autocomplete near the textarea
		this.positionNearTextarea(textarea);
		this.container.classList.remove('is-hidden');
		this.listEl.focus();
	}

	/** Close the autocomplete. */
	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.highlightedIndex = -1;
		this.searchQuery = '';
		this.triggerPosition = -1;
		this.container.classList.add('is-hidden');
		this.config.onClose();
	}

	/** Load all Markdown files from the vault as candidates. */
	private loadCandidates(): void {
		const files = listMarkdownFiles(this.config.app);
		this.candidates = files.map((file) => ({
			file,
			displayPath: file.path,
			name: file.basename,
		}));
	}

	/** Filter candidates by search query. */
	private updateFilter(): void {
		this.filtered = filterNoteCandidates(this.candidates, this.searchQuery);
		this.highlightedIndex = this.filtered.length > 0 ? 0 : -1;
		this.renderList();
	}

	/** Render the filtered candidate list. */
	private renderList(): void {
		this.listEl.empty();

		// Remove existing attachments from the list
		const existingPaths = new Set(this.existingAttachments.map((a) => a.path));

		for (let i = 0; i < this.filtered.length; i++) {
			const candidate = this.filtered[i];
			if (!candidate) continue;
			const isExisting = existingPaths.has(candidate.file.path);

			const item = this.listEl.createDiv({
				cls: 'obsaide-autocomplete-item',
				attr: { role: 'option', 'aria-selected': String(i === this.highlightedIndex) },
			});

			if (i === this.highlightedIndex) {
				item.addClass('is-highlighted');
			}

			const icon = item.createSpan({ cls: 'obsaide-autocomplete-icon' });
			setIcon(icon, 'file-text');

			const textContainer = item.createDiv({ cls: 'obsaide-autocomplete-text' });
			textContainer.createDiv({
				cls: 'obsaide-autocomplete-name',
				text: candidate.name,
			});
			textContainer.createDiv({
				cls: 'obsaide-autocomplete-path',
				text: candidate.displayPath,
			});

			if (isExisting) {
				const badge = item.createSpan({ cls: 'obsaide-autocomplete-badge', text: 'Added' });
				setTooltip(badge, 'Already attached as context');
			}

			item.addEventListener('click', () => {
				this.highlightedIndex = i;
				this.selectHighlighted();
			});
			item.addEventListener('mouseenter', () => {
				this.highlightedIndex = i;
				this.updateHighlight();
			});
		}

		if (this.filtered.length === 0) {
			const empty = this.listEl.createDiv({ cls: 'obsaide-autocomplete-empty' });
			empty.setText(this.searchQuery ? 'No matching notes' : 'No Markdown notes in vault');
		}
	}

	/** Highlight the next item. */
	private highlightNext(): void {
		if (this.filtered.length === 0) return;
		this.highlightedIndex = (this.highlightedIndex + 1) % this.filtered.length;
		this.updateHighlight();
		this.scrollIntoView();
	}

	/** Highlight the previous item. */
	private highlightPrevious(): void {
		if (this.filtered.length === 0) return;
		this.highlightedIndex =
			this.highlightedIndex <= 0 ? this.filtered.length - 1 : this.highlightedIndex - 1;
		this.updateHighlight();
		this.scrollIntoView();
	}

	/** Update visual highlight. */
	private updateHighlight(): void {
		const items = this.listEl.querySelectorAll('.obsaide-autocomplete-item');
		items.forEach((item, i) => {
			item.toggleClass('is-highlighted', i === this.highlightedIndex);
			item.setAttribute('aria-selected', String(i === this.highlightedIndex));
		});
	}

	/** Scroll highlighted item into view. */
	private scrollIntoView(): void {
		const item = this.listEl.querySelector('.obsaide-autocomplete-item.is-highlighted');
		item?.scrollIntoView({ block: 'nearest' });
	}

	/** Select the highlighted item and add as attachment. */
	private selectHighlighted(): void {
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.filtered.length) return;

		const candidate = this.filtered[this.highlightedIndex];
		if (!candidate) return;
		const attachment: NoteAttachment = {
			id: createId('a-'),
			kind: 'note',
			path: candidate.file.path,
			title: candidate.name,
			role: DEFAULT_ROLE,
		};

		this.config.onSelect(attachment);
		this.close();
	}

	/**
	 * Position the autocomplete above the composer, anchored to it rather than
	 * to the caret — a fixed-position popover placed outside the sidebar's
	 * scroll container, so `.obsaide-view`'s `overflow: hidden` never clips it
	 * and the composer itself never has to move to make room.
	 */
	private positionNearTextarea(textarea: HTMLTextAreaElement): void {
		// Anchor to the whole composer, not just the textarea, so the popover
		// tracks the input row even as it grows with typed text.
		const composerEl = textarea.closest('.obsaide-composer');
		const anchorEl = composerEl ?? textarea;
		const anchorRect = anchorEl.getBoundingClientRect();

		const gap = 8;
		const margin = 8;
		// Never exceed the space actually available above the composer, so the
		// list can't overlap the header or run off the top of the window.
		const maxHeight = Math.max(120, Math.min(300, anchorRect.top - gap - margin));
		const containerWidth = Math.min(400, anchorRect.width);
		const top = Math.max(margin, anchorRect.top - maxHeight - gap);
		const left = anchorRect.left;

		this.container.setCssStyles({
			position: 'fixed',
			top: `${top}px`,
			left: `${left}px`,
			zIndex: '1000',
			maxHeight: `${maxHeight}px`,
			width: `${containerWidth}px`,
		});
	}

	/** Update the list of existing attachments for deduplication. */
	updateExistingAttachments(attachments: readonly NoteAttachment[]): void {
		this.existingAttachments = attachments;
		if (this.isOpen) {
			this.renderList();
		}
	}

	/** Clean up DOM. */
	destroy(): void {
		this.container.remove();
	}
}