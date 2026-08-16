import { Notice, type Editor, type TFile } from 'obsidian';
import type { EditProposalTarget } from '../chat/conversation';
import { captureNote, captureSelection, getEditorTarget } from '../context/collect';
import type { Attachment } from '../context/types';
import type ObsAidePlugin from '../main';
import { PromptModal } from '../ui/prompt-modal';
import { createId } from '../utils/id';
import { summarize } from '../utils/text';
import type { AideAction } from './registry';

interface ActionScope {
	attachment: Attachment;
	proposal?: EditProposalTarget;
}

/**
 * Decide what the action operates on.
 *
 * A selection wins. Otherwise the whole note is used, and for actions that
 * rewrite content the exact text is snapshotted so the later diff is against
 * what the model actually saw.
 */
function captureScope(
	editor: Editor,
	file: TFile | null,
	action: AideAction,
): ActionScope | null {
	const selection = captureSelection(editor, file);
	if (selection) {
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		return {
			attachment: selection,
			proposal:
				action.mutates && file
					? {
							path: file.path,
							originalText: selection.text ?? '',
							from,
							to,
							scope: 'selection',
						}
					: undefined,
		};
	}

	if (!file) return null;
	const content = editor.getValue();
	if (!content.trim()) return null;

	if (!action.mutates) {
		return { attachment: captureNote(file) };
	}

	const title = `Whole note: ${summarize(file.basename, 24)}`;
	return {
		attachment: {
			id: createId('a-'),
			kind: 'selection',
			path: file.path,
			title,
			text: content,
		},
		proposal: {
			path: file.path,
			originalText: content,
			from: { line: 0, ch: 0 },
			to: editor.offsetToPos(content.length),
			scope: 'document',
		},
	};
}

export function canRunActions(plugin: ObsAidePlugin): boolean {
	return getEditorTarget(plugin.app) !== null;
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

	const scope = captureScope(target.editor, target.file, action);
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
		attachments: [scope.attachment],
		proposalTarget: scope.proposal,
	});
}
