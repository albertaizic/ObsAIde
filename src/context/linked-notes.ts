/**
 * Pure link-dedup logic, deliberately free of any Obsidian import so it can
 * be unit-tested without a vault. The Obsidian-facing resolver lives in
 * `linked-notes-vault.ts`.
 */

/** A Markdown note discovered through `[[wikilinks]]` in an attached note. */
export interface LinkedNoteCandidate {
	path: string;
	title: string;
	/** Basenames of the attached notes that link to this one, for the compact "Linked from" label. */
	sourceTitles: string[];
}

/**
 * One outgoing link, already resolved against the vault.
 *
 * Kept separate from `resolveLinkedNotes` so the dedup/filter rules can be
 * unit-tested with plain data instead of a mocked `App`.
 */
export interface ResolvedLink {
	sourcePath: string;
	sourceTitle: string;
	/** `null` when the link does not resolve to a real file (unresolved link). */
	targetPath: string | null;
	targetTitle: string;
	isMarkdown: boolean;
}

/**
 * Turn resolved links into the deduplicated, already-attached-excluded list a
 * picker shows the user.
 *
 * Only resolved Markdown links count: unresolved links and non-Markdown
 * files are silently dropped, not offered as broken choices. Links back to
 * their own source note are dropped too.
 */
export function dedupeLinkedNotes(
	links: readonly ResolvedLink[],
	excludePaths: ReadonlySet<string>,
): LinkedNoteCandidate[] {
	const byPath = new Map<string, LinkedNoteCandidate>();

	for (const link of links) {
		if (!link.targetPath || !link.isMarkdown) continue;
		if (link.targetPath === link.sourcePath) continue;
		if (excludePaths.has(link.targetPath)) continue;

		const existing = byPath.get(link.targetPath);
		if (existing) {
			if (!existing.sourceTitles.includes(link.sourceTitle)) {
				existing.sourceTitles.push(link.sourceTitle);
			}
			continue;
		}
		byPath.set(link.targetPath, {
			path: link.targetPath,
			title: link.targetTitle,
			sourceTitles: [link.sourceTitle],
		});
	}

	return [...byPath.values()].sort((a, b) => a.title.localeCompare(b.title));
}
