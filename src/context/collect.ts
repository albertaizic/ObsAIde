import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import { createId } from '../utils/id';
import { summarize } from '../utils/text';
import type { Attachment } from './types';

/** The editor the user is working in, if any. */
export interface EditorTarget {
	editor: Editor;
	file: TFile | null;
	view: MarkdownView;
}

export function getEditorTarget(app: App): EditorTarget | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return null;
	return { editor: view.editor, file: view.file, view };
}

/** Snapshot the current selection. Returns `null` when nothing is selected. */
export function captureSelection(
	editor: Editor,
	file: TFile | null,
): Attachment | null {
	const text = editor.getSelection();
	if (!text.trim()) return null;

	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	const where = file ? file.basename : 'the editor';

	return {
		id: createId('a-'),
		kind: 'selection',
		path: file?.path,
		title: `Selection in ${summarize(where, 24)}`,
		text,
		lines: { from: from.line + 1, to: to.line + 1 },
	};
}

/** Attach a whole note. Its content is read when the request is sent. */
export function captureNote(file: TFile): Attachment {
	return {
		id: createId('a-'),
		kind: 'note',
		path: file.path,
		title: file.basename,
	};
}

/** Markdown notes in the vault, newest first, for the note picker. */
export function listMarkdownFiles(app: App): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** True when an equivalent attachment is already present. */
export function isDuplicateAttachment(
	existing: readonly Attachment[],
	candidate: Attachment,
): boolean {
	return existing.some(
		(attachment) =>
			attachment.kind === candidate.kind &&
			attachment.path === candidate.path &&
			(candidate.kind === 'note' || attachment.text === candidate.text),
	);
}
