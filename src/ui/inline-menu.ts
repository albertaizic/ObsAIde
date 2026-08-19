import { type Editor, type EditorPosition, setIcon, type MarkdownView, TFile } from 'obsidian';
import { AIDE_ACTIONS, type AideAction } from '../actions/registry';
import type { CustomAction } from '../settings/types';
import { runAction, runCustomAction } from '../actions/runner';
import type ObsAidePlugin from '../main';
import { captureSelection, captureNote, getEditorTarget } from '../context/collect';
import type { Attachment } from '../context/types';
import { ASSISTANT_NAME } from '../constants';
import { openAskAide } from '../commands';

// Type for CodeMirror instance to avoid unsafe any
interface CodeMirrorInstance {
	cursorCoords(pos: EditorPosition): { top: number; bottom: number; left: number; right: number } | null;
}

/** Inline Aide menu that appears near text selections. */
export class InlineAideMenu {
	private readonly plugin: ObsAidePlugin;
	private menuEl: HTMLElement | null = null;
	private selectionChangeHandler: (() => void) | null = null;
	private isVisible = false;
	private lastSelection: { from: EditorPosition; to: EditorPosition } | null = null;
	private lastEditor: Editor | null = null;

	constructor(plugin: ObsAidePlugin) {
		this.plugin = plugin;
	}

	/** Start listening for selections. */
	enable(): void {
		// Listen for selection changes in the editor
		this.selectionChangeHandler = () => this.onSelectionChange();

		this.plugin.registerEvent(
			this.plugin.app.workspace.on('editor-change', this.selectionChangeHandler),
		);
	}

	/** Stop listening and clean up. */
	disable(): void {
		this.hide();
		// Event handlers are automatically cleaned up by Obsidian's registerEvent
	}

	/** Handle editor selection changes. */
	private onSelectionChange(): void {
		const target = getEditorTarget(this.plugin.app);
		if (!target) {
			this.hide();
			return;
		}

		const selection = target.editor.getSelection();
		if (!selection.trim()) {
			this.hide();
			return;
		}

		const from = target.editor.getCursor('from');
		const to = target.editor.getCursor('to');

		// Debounce: only update position if selection changed significantly
		if (
			this.lastSelection &&
			this.lastEditor === target.editor &&
			this.lastSelection.from.line === from.line &&
			this.lastSelection.from.ch === from.ch &&
			this.lastSelection.to.line === to.line &&
			this.lastSelection.to.ch === to.ch
		) {
			return;
		}

		this.lastSelection = { from, to };
		this.lastEditor = target.editor;
		this.show(target.editor, target.file, target.view, selection, from, to);
	}

	/** Show the inline menu near the selection. */
	private show(
		editor: Editor,
		file: TFile | null,
		view: MarkdownView,
		selectionText: string,
		from: EditorPosition,
		to: EditorPosition,
	): void {
		// Don't show if generating
		if (this.plugin.chat.isGenerating) {
			this.hide();
			return;
		}

		// Create or update menu element
		if (!this.menuEl) {
			this.createMenuElement();
		}

		if (!this.menuEl) return;

		// Position the menu
		this.positionMenu(editor, from, to);

		// Update actions based on context
		this.updateMenuActions(editor, file, view, selectionText);

		// Show
		this.menuEl.classList.remove('is-hidden');
		this.isVisible = true;
	}

	/** Create the menu DOM element. */
	private createMenuElement(): void {
		this.menuEl = document.body.createDiv({ cls: 'obsaide-inline-menu is-hidden' });

		// Close on click outside
		const closeHandler = (event: MouseEvent) => {
			if (this.menuEl && !this.menuEl.contains(event.target as Node)) {
				this.hide();
			}
		};
		document.addEventListener('mousedown', closeHandler);

		// Store cleanup
		this.plugin.register(() => {
			document.removeEventListener('mousedown', closeHandler);
		});
	}

	/** Position the menu near the selection. */
	private positionMenu(editor: Editor, from: EditorPosition, to: EditorPosition): void {
		if (!this.menuEl) return;

		// Get the CodeMirror instance to calculate position
		const cm = (editor as { cm?: CodeMirrorInstance }).cm;
		if (!cm) return;

		// Get cursor position relative to the editor
		const coords = cm.cursorCoords(from);
		if (!coords) return;

		const scrollInfo = editor.getScrollInfo();

		// Position below the selection
		const top = coords.bottom - scrollInfo.top + 4;
		const left = coords.left - scrollInfo.left;

		this.menuEl.style.setProperty('top', `${top}px`);
		this.menuEl.style.setProperty('left', `${left}px`);
	}

	/** Update menu with available actions. */
	private updateMenuActions(
		editor: Editor,
		file: TFile | null,
		view: MarkdownView,
		selectionText: string,
	): void {
		if (!this.menuEl) return;

		this.menuEl.empty();

		// Capture context for actions
		const selection = captureSelection(editor, file, 'primary');
		const attachments: Attachment[] = selection ? [selection] : [];
		if (file && selection) {
			// Supporting context for non-mutating actions - use the note as supporting context
			attachments.push(captureNote(file, 'supporting'));
		}

		// Add Ask Aide
		const askButton = this.menuEl.createEl('button', {
			cls: 'obsaide-inline-menu-item',
			text: `Ask ${ASSISTANT_NAME}`,
		});
		setIcon(askButton.createSpan({ cls: 'obsaide-inline-menu-icon' }), 'message-square');
		askButton.addEventListener('click', () => {
			openAskAide(this.plugin, attachments);
			this.hide();
		});

		// Add separator
		this.menuEl.createDiv({ cls: 'obsaide-inline-menu-separator' });

		// Built-in actions
		for (const action of AIDE_ACTIONS) {
			this.addActionButton(action, editor, file, view, selectionText, attachments);
		}

		// Custom actions
		const customActions = this.plugin.settings.customActions?.filter((a) => a.enabled) ?? [];
		if (customActions.length > 0) {
			this.menuEl.createDiv({ cls: 'obsaide-inline-menu-separator' });
			for (const customAction of customActions) {
				this.addCustomActionButton(customAction, editor, file, view, selectionText, attachments);
			}
		}
	}

	/** Add a built-in action button. */
	private addActionButton(
		action: AideAction,
		editor: Editor,
		file: TFile | null,
		view: MarkdownView,
		selectionText: string,
		attachments: Attachment[],
	): void {
		if (!this.menuEl) return;

		const button = this.menuEl.createEl('button', {
			cls: 'obsaide-inline-menu-item',
		});
		const iconEl = button.createSpan({ cls: 'obsaide-inline-menu-icon' });
		setIcon(iconEl, action.icon);
		button.createSpan({ cls: 'obsaide-inline-menu-label', text: action.label });

		button.addEventListener('click', () => {
			// Run the action
			void runAction(this.plugin, action);
			this.hide();
		});
	}

	/** Add a custom action button. */
	private addCustomActionButton(
		customAction: CustomAction,
		editor: Editor,
		file: TFile | null,
		view: MarkdownView,
		selectionText: string,
		attachments: Attachment[],
	): void {
		if (!this.menuEl) return;

		const button = this.menuEl.createEl('button', {
			cls: 'obsaide-inline-menu-item',
		});
		const iconEl = button.createSpan({ cls: 'obsaide-inline-menu-icon' });
		setIcon(iconEl, customAction.icon || 'zap');
		button.createSpan({ cls: 'obsaide-inline-menu-label', text: customAction.name });

		button.addEventListener('click', () => {
			void runCustomAction(this.plugin, customAction);
			this.hide();
		});
	}

	/** Hide the menu. */
	hide(): void {
		if (this.menuEl) {
			this.menuEl.classList.add('is-hidden');
		}
		this.isVisible = false;
		this.lastSelection = null;
		this.lastEditor = null;
	}

	/** Check if menu is currently visible. */
	isMenuVisible(): boolean {
		return this.isVisible;
	}
}