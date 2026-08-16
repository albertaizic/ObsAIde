import { MarkdownView, type App, type Editor, type EditorPosition } from 'obsidian';
import type { EditProposalTarget } from '../chat/conversation';

/**
 * Everything the apply step needs to know about the note a proposal targets.
 *
 * `range` is `null` when the original text can no longer be found, which is the
 * signal that replacing would destroy work the user did in the meantime.
 */
export interface ProposalTarget {
	view: MarkdownView;
	editor: Editor;
	range: { from: EditorPosition; to: EditorPosition } | null;
	/** The note changed since the reply was generated. */
	drifted: boolean;
}

function findMarkdownView(app: App, path: string): MarkdownView | null {
	let match: MarkdownView | null = null;
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === path) {
			match = view;
			break;
		}
	}
	return match;
}

/**
 * Locate the text a proposal was generated from.
 *
 * The stored range is trusted only when it still holds the same text. If the
 * note moved, the original is looked up once by content; anything ambiguous is
 * treated as drift rather than guessed at.
 */
export function resolveProposalTarget(
	app: App,
	proposal: EditProposalTarget,
): ProposalTarget | null {
	const view = findMarkdownView(app, proposal.path);
	if (!view) return null;
	const { editor } = view;

	const atStoredRange = editor.getRange(proposal.from, proposal.to);
	if (atStoredRange === proposal.originalText) {
		return {
			view,
			editor,
			range: { from: proposal.from, to: proposal.to },
			drifted: false,
		};
	}

	const document = editor.getValue();
	const first = document.indexOf(proposal.originalText);
	const last = document.lastIndexOf(proposal.originalText);
	if (first !== -1 && first === last) {
		return {
			view,
			editor,
			range: {
				from: editor.offsetToPos(first),
				to: editor.offsetToPos(first + proposal.originalText.length),
			},
			drifted: true,
		};
	}

	return { view, editor, range: null, drifted: true };
}

/** Any markdown editor the user is currently looking at. */
export function getActiveEditor(app: App): Editor | null {
	return app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
}

export function replaceRange(
	editor: Editor,
	range: { from: EditorPosition; to: EditorPosition },
	text: string,
): void {
	// `replaceRange` goes through the editor's own transaction history, so
	// Obsidian's undo reverts the change in one step.
	editor.replaceRange(text, range.from, range.to);
	editor.setSelection(range.from, editor.offsetToPos(editor.posToOffset(range.from) + text.length));
	editor.focus();
}

export function insertAfter(
	editor: Editor,
	position: EditorPosition,
	text: string,
): void {
	const prefix = position.ch === 0 ? '' : '\n\n';
	editor.replaceRange(`${prefix}${text}\n`, position);
	editor.focus();
}

export function insertAtCursor(editor: Editor, text: string): void {
	editor.replaceSelection(text);
	editor.focus();
}
