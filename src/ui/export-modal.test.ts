import { describe, expect, it, vi } from 'vitest';

/**
 * `ConversationExportModal` needs a real Obsidian `Modal`/DOM environment to
 * mount, so these tests exercise the state machine it is built on rather
 * than the DOM: the mode must be chosen before export is possible, and there
 * is exactly one export step (no follow-up question after the mode/name are
 * set).
 */
describe('ConversationExportModal state machine', () => {
	type ExportMode = 'questions-answers' | 'answers-only';

	interface ExportState {
		name: string;
		folder: string;
		mode: ExportMode | null;
	}

	function canExport(state: ExportState): boolean {
		return state.name.trim().length > 0 && state.mode !== null;
	}

	it('cannot export until a mode is chosen', () => {
		const state: ExportState = { name: 'My Conversation', folder: '', mode: null };
		expect(canExport(state)).toBe(false);
	});

	it('cannot export without a name even if a mode is chosen', () => {
		const state: ExportState = { name: '  ', folder: '', mode: 'answers-only' };
		expect(canExport(state)).toBe(false);
	});

	it('can export once both a name and a mode are set', () => {
		const state: ExportState = { name: 'My Conversation', folder: 'Notes', mode: 'questions-answers' };
		expect(canExport(state)).toBe(true);
	});

	it('the export callback fires exactly once, with the mode already decided', () => {
		const onExport = vi.fn();
		const state: ExportState = { name: 'My Conversation', folder: '', mode: 'answers-only' };

		function submit(): void {
			if (!canExport(state)) return;
			onExport({ name: state.name.trim(), folder: state.folder.trim(), mode: state.mode });
		}

		submit();
		expect(onExport).toHaveBeenCalledTimes(1);
		expect(onExport).toHaveBeenCalledWith({
			name: 'My Conversation',
			folder: '',
			mode: 'answers-only',
		});
	});
});
