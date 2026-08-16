/** Minimal line diff used to preview a proposed note edit. */
export type DiffKind = 'equal' | 'add' | 'remove';

export interface DiffLine {
	kind: DiffKind;
	text: string;
}

/** Above this, the LCS table costs more than the preview is worth. */
const MAX_DIFF_LINES = 1200;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');

	if (a.length + b.length > MAX_DIFF_LINES) {
		return [
			...a.map((text): DiffLine => ({ kind: 'remove', text })),
			...b.map((text): DiffLine => ({ kind: 'add', text })),
		];
	}

	// Longest common subsequence over lines.
	const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			const row = lengths[i];
			const next = lengths[i + 1];
			if (!row || !next) continue;
			row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
		}
	}

	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			result.push({ kind: 'equal', text: a[i] ?? '' });
			i += 1;
			j += 1;
			continue;
		}
		const down = lengths[i + 1]?.[j] ?? 0;
		const right = lengths[i]?.[j + 1] ?? 0;
		if (down >= right) {
			result.push({ kind: 'remove', text: a[i] ?? '' });
			i += 1;
		} else {
			result.push({ kind: 'add', text: b[j] ?? '' });
			j += 1;
		}
	}
	while (i < a.length) {
		result.push({ kind: 'remove', text: a[i] ?? '' });
		i += 1;
	}
	while (j < b.length) {
		result.push({ kind: 'add', text: b[j] ?? '' });
		j += 1;
	}
	return result;
}

export interface DiffSummary {
	added: number;
	removed: number;
	unchanged: number;
}

export function summarizeDiff(lines: readonly DiffLine[]): DiffSummary {
	const summary: DiffSummary = { added: 0, removed: 0, unchanged: 0 };
	for (const line of lines) {
		if (line.kind === 'add') summary.added += 1;
		else if (line.kind === 'remove') summary.removed += 1;
		else summary.unchanged += 1;
	}
	return summary;
}

/**
 * Collapse long runs of unchanged lines so a big note still produces a readable
 * preview. `context` lines are kept on each side of a change.
 */
export function collapseDiff(lines: readonly DiffLine[], context = 3): DiffLine[] {
	const keep = new Array<boolean>(lines.length).fill(false);
	lines.forEach((line, index) => {
		if (line.kind === 'equal') return;
		for (
			let offset = Math.max(0, index - context);
			offset <= Math.min(lines.length - 1, index + context);
			offset += 1
		) {
			keep[offset] = true;
		}
	});

	const result: DiffLine[] = [];
	let skipped = 0;
	lines.forEach((line, index) => {
		if (keep[index]) {
			if (skipped > 0) {
				result.push({ kind: 'equal', text: `… ${skipped} unchanged lines …` });
				skipped = 0;
			}
			result.push(line);
			return;
		}
		skipped += 1;
	});
	if (skipped > 0) {
		result.push({ kind: 'equal', text: `… ${skipped} unchanged lines …` });
	}
	return result;
}
