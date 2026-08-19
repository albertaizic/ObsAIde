import { Notice, type TFile } from 'obsidian';
import { computeCustomActionAvailability, type CustomActionAvailability } from './availability';
import { captureNote, captureSelection, getEditorTarget, captureSection } from '../context/collect';
import type { Attachment } from '../context/types';
import type ObsAidePlugin from '../main';
import { PromptModal } from '../ui/prompt-modal';
import { createId } from '../utils/id';
import { summarize } from '../utils/text';
import type { NoteEditAnchor } from './anchor';
import { captureAnchor, captureWholeNoteAnchor } from './edit-target';
import type { AideAction } from './registry';
import type { EditorTarget } from '../context/collect';
import type { CustomAction } from '../settings/types';

interface ActionScope {
	attachments: Attachment[];
	anchor: NoteEditAnchor | null;
}

/**
 * Decide what the action operates on.
 *
 * A selection wins, and the note it sits in travels with it as supporting
 * context so the model can resolve references the selection alone does not
 * explain. With no selection the whole note is the subject, and for rewriting
 * actions its exact text is snapshotted so the later diff matches what the
 * model saw.
 */
function captureScope(target: EditorTarget, action: AideAction): ActionScope | null {
	const { editor, file, view } = target;
	const selection = captureSelection(editor, file, 'primary');

	if (selection) {
		const attachments: Attachment[] = [selection];
		if (file && !action.mutates) attachments.push(captureNote(file, 'supporting'));
		return { attachments, anchor: captureAnchor(view) };
	}

	if (!file) return null;
	const content = editor.getValue();
	if (!content.trim()) return null;

	if (!action.mutates) {
		return { attachments: [captureNote(file, 'primary')], anchor: captureAnchor(view) };
	}

	return {
		attachments: [wholeNoteSnapshot(file, content)],
		anchor: captureWholeNoteAnchor(view),
	};
}

/**
 * A rewriting action on a whole note sends a snapshot rather than a re-read, so
 * the text the model transforms is exactly the text the diff compares against.
 */
function wholeNoteSnapshot(file: TFile, content: string): Attachment {
	return {
		id: createId('a-'),
		kind: 'selection',
		path: file.path,
		title: `Whole note: ${summarize(file.basename, 24)}`,
		text: content,
		role: 'primary',
	};
}

export function canRunActions(plugin: ObsAidePlugin): boolean {
	return getEditorTarget(plugin.app) !== null;
}

/**
 * Whether a custom action's declared context requirement is currently met,
 * and if not, why — so callers can disable it with a reason instead of
 * silently running on unrelated text. The decision itself lives in the
 * Obsidian-free `computeCustomActionAvailability`; this only gathers the
 * booleans from the live editor.
 */
export function describeCustomActionAvailability(
	plugin: ObsAidePlugin,
	action: CustomAction,
): CustomActionAvailability {
	const target = getEditorTarget(plugin.app);
	if (!target) return { available: false, reason: 'Open a note first' };

	const hasSelection = target.editor.getSelection().trim().length > 0;
	const hasSection = captureSection(plugin.app, target.editor, target.file, 'primary') !== null;

	return computeCustomActionAvailability({
		contextMode: action.contextMode,
		hasEditor: true,
		hasSelection,
		hasSection,
		hasFile: target.file !== null,
	});
}

/** Run a note action and stream the result into the Aide sidebar. */
export async function runAction(
	plugin: ObsAidePlugin,
	action: AideAction,
	instruction?: string,
): Promise<void> {
	const target = getEditorTarget(plugin.app);
	if (!target) {
		new Notice('Open a note in the editor first.');
		return;
	}

	if (action.needsInstruction && !instruction?.trim()) {
		new PromptModal(plugin.app, {
			title: action.commandName,
			description: action.instructionPrompt,
			placeholder: 'Make it more formal and cut the jargon',
			submitText: action.label,
			multiline: true,
			onSubmit: (value) => {
				if (value.trim()) void runAction(plugin, action, value);
			},
		}).open();
		return;
	}

	// Everything about the editor is captured before the sidebar is opened,
	// because opening it moves focus away from the note.
	const scope = captureScope(target, action);
	if (!scope) {
		new Notice('Select some text, or open a note with content.');
		return;
	}

	const prompt = action.build(instruction?.trim() ?? '');
	const view = await plugin.activateChatView();
	if (!view) {
		new Notice('Could not open Aide.');
		return;
	}

	await view.send({
		displayText: instruction?.trim()
			? `${action.label}: ${instruction.trim()}`
			: action.label,
		prompt: prompt.user,
		actionLabel: action.label,
		actionInstructions: prompt.system,
		attachments: scope.attachments,
		anchor: scope.anchor ?? undefined,
		replacesAnchor: action.mutates,
		anchorView: target.view,
	});
}

/** Run a custom action and stream the result into the Aide sidebar. */
export async function runCustomAction(
	plugin: ObsAidePlugin,
	customAction: CustomAction,
): Promise<void> {
	const target = getEditorTarget(plugin.app);
	if (!target) {
		new Notice('Open a note in the editor first.');
		return;
	}

	const availability = describeCustomActionAvailability(plugin, customAction);
	if (!availability.available) {
		new Notice(`${customAction.name}: ${availability.reason}`);
		return;
	}

	const { editor, file, view } = target;

	// Build attachments based on context mode
	let attachments: Attachment[] = [];
	let anchor: NoteEditAnchor | null = null;

	if (customAction.contextMode === 'selection') {
		const selection = captureSelection(editor, file, 'primary');
		if (selection) {
			attachments.push(selection);
			if (file) attachments.push(captureNote(file, 'supporting'));
			anchor = captureAnchor(view);
		} else if (file) {
			attachments.push(captureNote(file, 'primary'));
			anchor = captureAnchor(view);
		}
	} else if (customAction.contextMode === 'section') {
		const sectionAttach = captureSection(plugin.app, editor, file, 'primary');
		if (sectionAttach) {
			attachments.push(sectionAttach);
			anchor = captureAnchor(view);
		} else if (file) {
			attachments.push(captureNote(file, 'primary'));
			anchor = captureAnchor(view);
		}
	} else if (customAction.contextMode === 'note' && file) {
		attachments.push(captureNote(file, 'primary'));
		anchor = captureAnchor(view);
	} else {
		// Smart/default: same as selection
		const selection = captureSelection(editor, file, 'primary');
		if (selection) {
			attachments.push(selection);
			if (file) attachments.push(captureNote(file, 'supporting'));
			anchor = captureAnchor(view);
		} else if (file) {
			attachments.push(captureNote(file, 'primary'));
			anchor = captureAnchor(view);
		}
	}

	if (attachments.length === 0) {
		new Notice('Select some text, or open a note with content.');
		return;
	}

	// Build prompt from custom action instruction
	const prompt = customAction.instruction;

	const chatView = await plugin.activateChatView();
	if (!chatView) {
		new Notice('Could not open Aide.');
		return;
	}

	// Determine if this is a rewrite action
	const isRewrite = customAction.outputMode === 'rewrite';

	await chatView.send({
		displayText: customAction.name,
		prompt: prompt,
		actionLabel: customAction.name,
		actionInstructions: '', // Custom actions don't have separate system instructions
		attachments,
		anchor: anchor ?? undefined,
		replacesAnchor: isRewrite,
		anchorView: view,
	});
}
