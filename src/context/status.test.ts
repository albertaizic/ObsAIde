import { describe, expect, it } from 'vitest';
import { describeScopeStatus, type ScopeStatusInput } from './status';

function baseInput(overrides: Partial<ScopeStatusInput> = {}): ScopeStatusInput {
	return {
		scope: 'none',
		hasEditor: true,
		hasSelection: false,
		activeFileName: null,
		sectionBreadcrumb: null,
		linkedCount: 0,
		folderPath: null,
		...overrides,
	};
}

describe('describeScopeStatus', () => {
	it('none scope reports no context attached', () => {
		expect(describeScopeStatus(baseInput({ scope: 'none' }))).toBe('No context attached');
	});

	it('selection scope with nothing selected does not substitute other context', () => {
		expect(describeScopeStatus(baseInput({ scope: 'selection', hasSelection: false }))).toBe(
			'Selection: No text selected',
		);
	});

	it('selection scope with a selection reports it is attached', () => {
		expect(describeScopeStatus(baseInput({ scope: 'selection', hasSelection: true }))).toBe(
			'Selection: attached',
		);
	});

	it('section scope with no usable editor reports no active section', () => {
		expect(describeScopeStatus(baseInput({ scope: 'section', hasEditor: false }))).toBe(
			'Section: No active section',
		);
	});

	it('section scope with an editor but no section at cursor does not fall back to the whole note', () => {
		expect(
			describeScopeStatus(
				baseInput({ scope: 'section', hasEditor: true, sectionBreadcrumb: null }),
			),
		).toBe('Section: No section at cursor');
	});

	it('section scope shows the breadcrumb when a section is resolved', () => {
		expect(
			describeScopeStatus(
				baseInput({
					scope: 'section',
					hasEditor: true,
					sectionBreadcrumb: 'Algorithms › Binary Search › Complexity',
				}),
			),
		).toBe('Section: Algorithms › Binary Search › Complexity');
	});

	it('note scope with an active note names it', () => {
		expect(describeScopeStatus(baseInput({ scope: 'note', activeFileName: 'Algorithms.md' }))).toBe(
			'Note: Algorithms.md',
		);
	});

	it('note scope with no active note is explicit', () => {
		expect(describeScopeStatus(baseInput({ scope: 'note', activeFileName: null }))).toBe(
			'Note: No active note',
		);
	});

	it('linked scope reports a count when links are available', () => {
		expect(describeScopeStatus(baseInput({ scope: 'linked', linkedCount: 3 }))).toBe(
			'Linked notes: 3 available',
		);
	});

	it('linked scope reports none found when there are no links', () => {
		expect(describeScopeStatus(baseInput({ scope: 'linked', linkedCount: 0 }))).toBe(
			'Linked notes: None found',
		);
	});

	it('folder scope names the selected folder', () => {
		expect(
			describeScopeStatus(baseInput({ scope: 'folder', folderPath: 'Coursework/Algorithms' })),
		).toBe('Folder: Coursework/Algorithms');
	});

	it('folder scope with nothing selected is explicit', () => {
		expect(describeScopeStatus(baseInput({ scope: 'folder', folderPath: null }))).toBe(
			'Folder: No folder selected',
		);
	});
});
