import type { CustomActionContextMode } from '../settings/types';

export interface CustomActionAvailabilityInput {
	contextMode: CustomActionContextMode;
	hasEditor: boolean;
	hasSelection: boolean;
	/** Whether the cursor resolves to a usable Markdown section. */
	hasSection: boolean;
	hasFile: boolean;
}

export interface CustomActionAvailability {
	available: boolean;
	reason: string | null;
}

/**
 * Pure decision table for whether a custom action's declared context
 * requirement is currently met. Kept free of any Obsidian import so it can
 * be unit-tested without a vault; `describeCustomActionAvailability` in
 * `runner.ts` gathers the booleans from the live editor and delegates here.
 */
export function computeCustomActionAvailability(
	input: CustomActionAvailabilityInput,
): CustomActionAvailability {
	if (!input.hasEditor) return { available: false, reason: 'Open a note first' };

	switch (input.contextMode) {
		case 'selection':
			return input.hasSelection
				? { available: true, reason: null }
				: { available: false, reason: 'No selection' };
		case 'section':
			return input.hasSection
				? { available: true, reason: null }
				: { available: false, reason: 'No section at cursor' };
		case 'note':
			return input.hasFile
				? { available: true, reason: null }
				: { available: false, reason: 'No active note' };
		case 'smart':
		default:
			return { available: true, reason: null };
	}
}
