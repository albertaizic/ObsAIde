/**
 * Folder attachments, expressed over plain paths so the rules can be tested
 * without a vault.
 *
 * ObsAIde only ever treats Markdown as context. Non-Markdown files are not
 * "unsupported", they simply never enter the pipeline: the vault's Markdown
 * index is the input, so images, PDFs and everything else are absent by
 * construction rather than filtered out with an error.
 */

export const MARKDOWN_EXTENSION = 'md';

export function isMarkdownPath(path: string): boolean {
	return path.toLowerCase().endsWith(`.${MARKDOWN_EXTENSION}`);
}

/** The vault root, however Obsidian happens to spell it. */
function isRoot(folderPath: string): boolean {
	const trimmed = folderPath.trim();
	return trimmed === '' || trimmed === '/' || trimmed === '.';
}

/**
 * Canonical folder identity: no leading/trailing slashes, no "." spelling,
 * and the vault root is always the empty string. Two paths are the same
 * folder iff their normalized forms are equal — "" and "/" must never
 * produce two entries in a picker or a selection.
 */
export function normalizeFolderPath(folderPath: string): string {
	const trimmed = folderPath.trim();
	if (trimmed === '' || trimmed === '/' || trimmed === '.') return '';
	return trimmed.replace(/^\/+|\/+$/g, '');
}

/** Whether a path denotes the vault root under its canonical identity. */
export function isVaultRootPath(folderPath: string): boolean {
	return normalizeFolderPath(folderPath) === '';
}

/**
 * Whether a file sits inside a folder, at any depth.
 *
 * The trailing separator matters: `Coursework2/notes.md` is not inside
 * `Coursework`.
 */
export function isInsideFolder(filePath: string, folderPath: string): boolean {
	if (isRoot(folderPath)) return true;
	const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
	return filePath.startsWith(prefix);
}

/**
 * The Markdown notes an attached folder contributes, deepest paths included.
 *
 * Sorted by path so the same folder always produces the same context in the
 * same order, which keeps truncation predictable.
 */
export function selectFolderNotePaths(
	markdownPaths: readonly string[],
	folderPath: string,
): string[] {
	return markdownPaths
		.filter((path) => isMarkdownPath(path) && isInsideFolder(path, folderPath))
		.sort((a, b) => a.localeCompare(b));
}

/** Label for a folder chip: the folder's own name, or the vault root. */
export function folderDisplayName(folderPath: string): string {
	if (isRoot(folderPath)) return 'Vault root';
	const trimmed = folderPath.replace(/\/+$/, '');
	const lastSlash = trimmed.lastIndexOf('/');
	return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

/** "4 notes" / "1 note", for chips and tooltips. */
export function describeNoteCount(count: number): string {
	return `${count} ${count === 1 ? 'note' : 'notes'}`;
}
