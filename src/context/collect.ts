import { MarkdownView, TFile, TFolder, type App, type Editor } from 'obsidian';
import { createId } from '../utils/id';
import { summarize } from '../utils/text';
import { folderDisplayName, selectFolderNotePaths } from './folder';
import { createSectionAttachment, type SectionAttachment } from './section';
import type { Attachment, ContextRole } from './types';

/** The editor the user is working in, if any. */
export interface EditorTarget {
	editor: Editor;
	file: TFile | null;
	view: MarkdownView;
}

export function getEditorTarget(app: App): EditorTarget | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active) return { editor: active.editor, file: active.file, view: active };

	// Attaching context from the Aide sidebar means the sidebar holds focus, so
	// fall back to the note the user was last editing in the main area.
	const recent = app.workspace.getMostRecentLeaf()?.view;
	if (recent instanceof MarkdownView) {
		return { editor: recent.editor, file: recent.file, view: recent };
	}
	return null;
}

/** Snapshot the current selection. Returns `null` when nothing is selected. */
export function captureSelection(
	editor: Editor,
	file: TFile | null,
	role: ContextRole = 'primary',
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
		role,
	};
}

/** Attach a whole note. Its content is read when the request is sent. */
export function captureNote(file: TFile, role: ContextRole = 'primary'): Attachment {
	return {
		id: createId('a-'),
		kind: 'note',
		path: file.path,
		title: file.basename,
		role,
	};
}

/**
 * Attach a folder.
 *
 * The Markdown notes are counted now so the chip can say how much is involved,
 * but their contents are read at send time.
 */
export function captureFolder(
	app: App,
	folder: TFolder,
	role: ContextRole = 'primary',
): Attachment {
	const notes = listFolderNotes(app, folder.path);
	return {
		id: createId('a-'),
		kind: 'folder',
		path: folder.path,
		title: folderDisplayName(folder.path),
		noteCount: notes.length,
		role,
	};
}

/**
 * Markdown notes inside a folder, at any depth, in a stable order.
 *
 * Built from the vault's in-memory Markdown index rather than by walking the
 * filesystem, so non-Markdown files never appear and no directory is scanned.
 */
export function listFolderNotes(app: App, folderPath: string): TFile[] {
	const byPath = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) byPath.set(file.path, file);

	return selectFolderNotePaths([...byPath.keys()], folderPath)
		.map((path) => byPath.get(path))
		.filter((file): file is TFile => file !== undefined);
}

/** Markdown notes in the vault, newest first, for the note picker. */
export function listMarkdownFiles(app: App): TFile[] {
	return app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** Folders that contain at least one Markdown note, for the folder picker. */
export function listNoteFolders(app: App): TFolder[] {
	const withNotes = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		let parent = file.parent;
		while (parent) {
			withNotes.add(parent.path);
			parent = parent.parent;
		}
	}

	const folders: TFolder[] = [];
	for (const entry of app.vault.getAllLoadedFiles()) {
		if (entry instanceof TFolder && withNotes.has(entry.path)) folders.push(entry);
	}
	return folders.sort((a, b) => a.path.localeCompare(b.path));
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
			(candidate.kind !== 'selection' || attachment.text === candidate.text),
	);
}

/**
 * Context for Ask Aide.
 *
 * A selection is what the user is asking about, but on its own it loses whatever
 * the surrounding note established — "its time complexity is O(log n)" means
 * nothing without the heading above it. The containing note therefore travels
 * with the selection as supporting context, visibly and removably.
 */
export function captureAskContext(app: App): Attachment[] {
	const target = getEditorTarget(app);
	if (target) {
		const selection = captureSelection(target.editor, target.file, 'primary');
		if (selection && target.file) {
			return [selection, captureNote(target.file, 'supporting')];
		}
		if (selection) return [selection];
		if (target.file) return [captureNote(target.file, 'primary')];
	}

	const activeFile = app.workspace.getActiveFile();
	return activeFile ? [captureNote(activeFile, 'primary')] : [];
}

/** Capture the current Markdown section as context. */
export function captureSection(
	app: App,
	editor: Editor,
	file: TFile | null,
	role: ContextRole = 'primary',
): SectionAttachment | null {
	return createSectionAttachment(app, editor, file, role);
}
