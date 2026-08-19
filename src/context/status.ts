import type { ContextScope } from '../settings/types';

/** What is actually available for each scope, gathered by the caller. */
export interface ScopeStatusInput {
	scope: ContextScope;
	/** Whether there is a usable editor (active or last-known) to read from. */
	hasEditor: boolean;
	hasSelection: boolean;
	activeFileName: string | null;
	/**
	 * Breadcrumb for the section at the cursor, `null` when the cursor is not in
	 * a usable section (e.g. before the first heading with no content there).
	 */
	sectionBreadcrumb: string | null;
	linkedCount: number;
	folderPath: string | null;
}

/**
 * Compact, unambiguous description of what a context scope will send.
 *
 * Every scope must resolve to a status the user can read before sending — an
 * empty selection or a cursor outside any section must never be silently
 * swapped for unrelated context.
 */
export function describeScopeStatus(input: ScopeStatusInput): string {
	switch (input.scope) {
		case 'none':
			return 'No context attached';
		case 'selection':
			return input.hasSelection ? 'Selection: attached' : 'Selection: No text selected';
		case 'section':
			if (!input.hasEditor) return 'Section: No active section';
			return input.sectionBreadcrumb
				? `Section: ${input.sectionBreadcrumb}`
				: 'Section: No section at cursor';
		case 'note':
			return input.activeFileName ? `Note: ${input.activeFileName}` : 'Note: No active note';
		case 'linked':
			return input.linkedCount > 0
				? `Linked notes: ${input.linkedCount} available`
				: 'Linked notes: None found';
		case 'folder':
			return input.folderPath ? `Folder: ${input.folderPath}` : 'Folder: No folder selected';
		default:
			return 'No context attached';
	}
}
