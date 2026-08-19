import { TFile, type App } from 'obsidian';
import { dedupeLinkedNotes, type LinkedNoteCandidate, type ResolvedLink } from './linked-notes';

/**
 * Resolve the outgoing Markdown links of one or more attached notes, via
 * Obsidian's MetadataCache. Nothing here reads note contents beyond what the
 * cache already indexed.
 */
export function resolveLinkedNotes(
	app: App,
	sourceFiles: readonly TFile[],
	excludePaths: ReadonlySet<string>,
): LinkedNoteCandidate[] {
	const links: ResolvedLink[] = [];

	for (const file of sourceFiles) {
		const cache = app.metadataCache.getFileCache(file);
		for (const link of cache?.links ?? []) {
			const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
			links.push({
				sourcePath: file.path,
				sourceTitle: file.basename,
				targetPath: dest ? dest.path : null,
				targetTitle: dest ? dest.basename : link.link,
				isMarkdown: dest instanceof TFile && dest.extension === 'md',
			});
		}
	}

	return dedupeLinkedNotes(links, excludePaths);
}
