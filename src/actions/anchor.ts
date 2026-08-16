/**
 * Where an assistant reply came from, and where it may be written back to.
 *
 * This module is deliberately free of Obsidian imports so the position logic can
 * be tested directly. `EditorLike` is the subset of Obsidian's `Editor` that the
 * anchor logic needs.
 */

export interface Position {
	line: number;
	ch: number;
}

export interface SelectionAnchor {
	from: Position;
	to: Position;
	/** The text that was selected when the request was made. */
	text: string;
}

/**
 * Captured when a request is made, persisted with the reply.
 *
 * It records the note, the caret and any selection, so an answer can be
 * inserted back where the user was working even after the sidebar and a modal
 * have both taken focus.
 */
export interface NoteEditAnchor {
	path: string;
	cursor: Position;
	selection?: SelectionAnchor;
	/** The selection covers the whole note (a whole-note action). */
	wholeDocument?: boolean;
}

export interface EditorLike {
	lastLine(): number;
	getLine(line: number): string;
	getValue(): string;
	getRange(from: Position, to: Position): string;
	offsetToPos(offset: number): Position;
	posToOffset(pos: Position): number;
}

export interface ClampedPosition {
	position: Position;
	/** The stored position no longer existed and had to be moved. */
	clamped: boolean;
}

/**
 * Bring a stored position back inside the current document.
 *
 * Notes get edited while a reply is generating, so a caret captured minutes ago
 * can point past the end of the file. Clamping keeps insertion inside the
 * intended note instead of throwing or landing somewhere arbitrary.
 */
export function clampPosition(editor: EditorLike, position: Position): ClampedPosition {
	const lastLine = editor.lastLine();
	const line = Math.min(Math.max(0, Math.floor(position.line)), lastLine);
	const lineLength = editor.getLine(line).length;
	const ch = Math.min(Math.max(0, Math.floor(position.ch)), lineLength);
	const clamped = line !== position.line || ch !== position.ch;
	return { position: { line, ch }, clamped };
}

export interface ResolvedSelection {
	from: Position;
	to: Position;
	/** The selection was found somewhere other than where it was captured. */
	drifted: boolean;
}

/**
 * Find the captured selection in the document as it is now.
 *
 * The stored range is trusted only while it still holds the same text. Failing
 * that the text is looked up by content, and only an unambiguous single match
 * counts: anything else returns `null` so the caller can refuse to overwrite.
 */
export function locateSelection(
	editor: EditorLike,
	selection: SelectionAnchor,
): ResolvedSelection | null {
	if (!selection.text) return null;

	if (editor.getRange(selection.from, selection.to) === selection.text) {
		return { from: selection.from, to: selection.to, drifted: false };
	}

	const document = editor.getValue();
	const first = document.indexOf(selection.text);
	if (first === -1 || first !== document.lastIndexOf(selection.text)) return null;

	return {
		from: editor.offsetToPos(first),
		to: editor.offsetToPos(first + selection.text.length),
		drifted: true,
	};
}

/** The caret an "insert at cursor" should use, brought back in range. */
export function insertionPoint(editor: EditorLike, anchor: NoteEditAnchor): ClampedPosition {
	return clampPosition(editor, anchor.cursor);
}

/** Position of the caret once `text` has been inserted at `at`. */
export function positionAfterInsert(
	editor: EditorLike,
	at: Position,
	text: string,
): Position {
	return editor.offsetToPos(editor.posToOffset(at) + text.length);
}

/**
 * Text to insert below a range, with the blank line that keeps Markdown blocks
 * apart. Returns the exact string so callers do not each invent their own.
 */
export function blockAfterText(editor: EditorLike, at: Position, text: string): string {
	const trailing = editor.getLine(at.line).slice(at.ch);
	const prefix = at.ch === 0 && !trailing ? '' : '\n\n';
	return `${prefix}${text}`;
}

/** True when the anchor still describes a note that can be written to. */
export function anchorHasSelection(anchor: NoteEditAnchor | undefined): boolean {
	return Boolean(anchor?.selection?.text);
}
