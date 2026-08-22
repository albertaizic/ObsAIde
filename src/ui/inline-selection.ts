/** A caret-anchored selection range, structural enough to test without Obsidian. */
export interface SelectionRange {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
}

/**
 * Whether the current selection is identical to the one already shown.
 *
 * The inline menu repositions on every editor change otherwise, so this is
 * its debounce: same anchors means leave the menu where it is.
 */
export function isUnchangedSelection(last: SelectionRange | null, current: SelectionRange): boolean {
	if (!last) return false;
	return (
		last.from.line === current.from.line &&
		last.from.ch === current.from.ch &&
		last.to.line === current.to.line &&
		last.to.ch === current.to.ch
	);
}
