import { describe, expect, it } from 'vitest';
import { computeCustomActionAvailability, type CustomActionAvailabilityInput } from './availability';

function input(overrides: Partial<CustomActionAvailabilityInput> = {}): CustomActionAvailabilityInput {
	return {
		contextMode: 'smart',
		hasEditor: true,
		hasSelection: false,
		hasSection: false,
		hasFile: true,
		...overrides,
	};
}

describe('computeCustomActionAvailability', () => {
	it('is unavailable when there is no editor at all, regardless of mode', () => {
		expect(computeCustomActionAvailability(input({ hasEditor: false }))).toEqual({
			available: false,
			reason: 'Open a note first',
		});
	});

	it('smart mode is always available with an editor', () => {
		expect(computeCustomActionAvailability(input({ contextMode: 'smart' }))).toEqual({
			available: true,
			reason: null,
		});
	});

	it('selection mode requires an actual selection', () => {
		expect(
			computeCustomActionAvailability(input({ contextMode: 'selection', hasSelection: false })),
		).toEqual({ available: false, reason: 'No selection' });
		expect(
			computeCustomActionAvailability(input({ contextMode: 'selection', hasSelection: true })),
		).toEqual({ available: true, reason: null });
	});

	it('section mode requires a resolvable section', () => {
		expect(
			computeCustomActionAvailability(input({ contextMode: 'section', hasSection: false })),
		).toEqual({ available: false, reason: 'No section at cursor' });
		expect(
			computeCustomActionAvailability(input({ contextMode: 'section', hasSection: true })),
		).toEqual({ available: true, reason: null });
	});

	it('note mode requires an active file', () => {
		expect(computeCustomActionAvailability(input({ contextMode: 'note', hasFile: false }))).toEqual({
			available: false,
			reason: 'No active note',
		});
		expect(computeCustomActionAvailability(input({ contextMode: 'note', hasFile: true }))).toEqual({
			available: true,
			reason: null,
		});
	});
});

describe('enabled custom action filtering', () => {
	interface Action {
		id: string;
		enabled: boolean;
	}

	function enabledOnly(actions: Action[]): Action[] {
		return actions.filter((a) => a.enabled);
	}

	it('includes enabled actions and excludes disabled ones', () => {
		const actions: Action[] = [
			{ id: 'a', enabled: true },
			{ id: 'b', enabled: false },
			{ id: 'c', enabled: true },
		];
		expect(enabledOnly(actions).map((a) => a.id)).toEqual(['a', 'c']);
	});

	it('returns nothing when every action is disabled', () => {
		const actions: Action[] = [{ id: 'a', enabled: false }];
		expect(enabledOnly(actions)).toEqual([]);
	});
});
