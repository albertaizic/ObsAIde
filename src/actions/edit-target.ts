import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import {
	blockAfterText,
	clampPosition,
	insertionPoint,
	locateSelection,
	positionAfterInsert,
	type NoteEditAnchor,
	type Position,
	type ResolvedSelection,
} from './anchor';

/**
 * Resolution of an anchor against the workspace as it is right now.
 *
 * Nothing here looks at which leaf has focus: by the time the user presses
 * "Insert at cursor" the Aide sidebar and a modal have both taken focus, so the
 * active view is never the note the reply came from.
 */
export interface ResolvedEditTarget {
	view: MarkdownView;
	editor: Editor;
	file: TFile;
	/** Caret to insert at, brought back inside the current document. */
	cursor: Position;
	/** The caret had to be moved because the note shrank. */
	cursorMoved: boolean;
	/** The captured selection, when it can still be located unambiguously. */
	selection: ResolvedSelection | null;
}

/**
 * Remembers which Markdown view a reply was generated from.
 *
 * Runtime only: a view cannot be serialised, so this is keyed by message ID and
 * rebuilt naturally as the user works. When an entry is missing — after a
 * restart, say — resolution falls back to finding the note by path.
 */
export class EditTargetRegistry {
	private readonly views = new Map<string, MarkdownView>();

	remember(messageId: string, view: MarkdownView | null | undefined): void {
		if (view) this.views.set(messageId, view);
	}

	recall(messageId: string): MarkdownView | null {
		return this.views.get(messageId) ?? null;
	}

	clear(): void {
		this.views.clear();
	}
}

/** Every open Markdown view, in workspace order. */
function markdownViews(app: App): MarkdownView[] {
	const views: MarkdownView[] = [];
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		if (leaf.view instanceof MarkdownView) views.push(leaf.view);
	}
	return views;
}

/** Capture the caret and any selection of a Markdown view. */
export function captureAnchor(view: MarkdownView): NoteEditAnchor | null {
	const file = view.file;
	if (!file) return null;
	const { editor } = view;

	const selectedText = editor.getSelection();
	const anchor: NoteEditAnchor = {
		path: file.path,
		cursor: toPlainPosition(editor.getCursor('from')),
	};
	if (selectedText) {
		anchor.selection = {
			from: toPlainPosition(editor.getCursor('from')),
			to: toPlainPosition(editor.getCursor('to')),
			text: selectedText,
		};
	}
	return anchor;
}

/** Capture an anchor covering the entire note, for whole-note actions. */
export function captureWholeNoteAnchor(view: MarkdownView): NoteEditAnchor | null {
	const file = view.file;
	if (!file) return null;
	const content = view.editor.getValue();
	return {
		path: file.path,
		cursor: { line: 0, ch: 0 },
		selection: {
			from: { line: 0, ch: 0 },
			to: toPlainPosition(view.editor.offsetToPos(content.length)),
			text: content,
		},
		wholeDocument: true,
	};
}

function toPlainPosition(position: { line: number; ch: number }): Position {
	return { line: position.line, ch: position.ch };
}

/**
 * Find the note an anchor points at.
 *
 * The view the reply was generated from wins when it is still open on the same
 * file; otherwise any open view of that note is used. Returns `null` when the
 * note is closed or gone, which is the signal to disable insertion rather than
 * write somewhere else.
 */
export function resolveEditTarget(
	app: App,
	anchor: NoteEditAnchor | undefined,
	preferred?: MarkdownView | null,
): ResolvedEditTarget | null {
	if (!anchor) return null;

	const file = app.vault.getAbstractFileByPath(anchor.path);
	if (!(file instanceof TFile)) return null;

	const open = markdownViews(app).filter((view) => view.file?.path === anchor.path);
	const view = (preferred && open.includes(preferred) ? preferred : open[0]) ?? null;
	if (!view) return null;

	const { editor } = view;
	const cursor = insertionPoint(editor, anchor);
	const selection = anchor.selection ? locateSelection(editor, anchor.selection) : null;

	return {
		view,
		editor,
		file,
		cursor: cursor.position,
		cursorMoved: cursor.clamped,
		selection,
	};
}

/** True when a reply could be inserted somewhere right now. */
export function canInsert(
	app: App,
	anchor: NoteEditAnchor | undefined,
	preferred?: MarkdownView | null,
): boolean {
	return resolveEditTarget(app, anchor, preferred) !== null;
}

/**
 * Bring the note back into view after a write.
 *
 * Focus is set *after* the edit has been applied; it is never used to work out
 * which editor to write to.
 */
async function reveal(app: App, target: ResolvedEditTarget): Promise<void> {
	await app.workspace.revealLeaf(target.view.leaf);
	target.editor.focus();
}

/** Insert at the caret captured when the request was made. */
export async function insertAtAnchor(
	app: App,
	target: ResolvedEditTarget,
	text: string,
): Promise<void> {
	target.editor.replaceRange(text, target.cursor);
	target.editor.setCursor(positionAfterInsert(target.editor, target.cursor, text));
	await reveal(app, target);
}

/** Insert immediately after the captured selection. */
export async function insertBelowSelection(
	app: App,
	target: ResolvedEditTarget,
	range: ResolvedSelection,
	text: string,
): Promise<void> {
	const body = blockAfterText(target.editor, range.to, text);
	target.editor.replaceRange(body, range.to);
	target.editor.setCursor(positionAfterInsert(target.editor, range.to, body));
	await reveal(app, target);
}

/** Replace the captured selection, or the whole note for a whole-note action. */
export async function replaceSelection(
	app: App,
	target: ResolvedEditTarget,
	range: ResolvedSelection,
	text: string,
): Promise<void> {
	// `replaceRange` goes through the editor's own transaction history, so
	// Obsidian's undo reverts the change in a single step.
	target.editor.replaceRange(text, range.from, range.to);
	const end = positionAfterInsert(target.editor, range.from, text);
	target.editor.setSelection(range.from, clampPosition(target.editor, end).position);
	await reveal(app, target);
}
