import { describe, expect, it } from 'vitest';
import { validateExportInput } from '../chat/export';

/**
 * The export gate lives in chat/export.ts so it is importable without a real
 * Obsidian `Modal`/DOM environment: nothing exports until there is a usable
 * name and a chosen mode, and what comes out is exactly what gets written.
 */
describe('validateExportInput', () => {
	it('rejects an empty name as missing-name', () => {
		expect(validateExportInput('', 'Notes', 'answers-only')).toEqual({
			valid: false,
			reason: 'missing-name',
		});
	});

	it('rejects a whitespace-only name as missing-name', () => {
		expect(validateExportInput('   ', 'Notes', 'questions-answers')).toEqual({
			valid: false,
			reason: 'missing-name',
		});
	});

	it('rejects a missing name regardless of the mode', () => {
		expect(validateExportInput('\t\n', '', null)).toEqual({
			valid: false,
			reason: 'missing-name',
		});
	});

	it('requires a mode once a name is present', () => {
		expect(validateExportInput('My Conversation', 'Notes', null)).toEqual({
			valid: false,
			reason: 'missing-mode',
		});
	});

	it('accepts answers-only exports', () => {
		expect(validateExportInput('My Conversation', 'Notes', 'answers-only')).toEqual({
			valid: true,
			name: 'My Conversation',
			folder: 'Notes',
			mode: 'answers-only',
		});
	});

	it('accepts questions-answers exports', () => {
		expect(validateExportInput('My Conversation', 'Notes', 'questions-answers')).toEqual({
			valid: true,
			name: 'My Conversation',
			folder: 'Notes',
			mode: 'questions-answers',
		});
	});

	it('trims the returned name and folder on success', () => {
		expect(
			validateExportInput('  Spaced Repetition  ', '  Notes/Studying  ', 'answers-only'),
		).toEqual({
			valid: true,
			name: 'Spaced Repetition',
			folder: 'Notes/Studying',
			mode: 'answers-only',
		});
	});

	it('trims the folder even when only the name carries surrounding spaces', () => {
		expect(
			validateExportInput('Clean Name', '  Folder With Spaces  ', 'questions-answers'),
		).toEqual({
			valid: true,
			name: 'Clean Name',
			folder: 'Folder With Spaces',
			mode: 'questions-answers',
		});
	});
});
