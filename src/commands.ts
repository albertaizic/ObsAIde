import { Notice, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import { captureAnchor } from './actions/edit-target';
import { AIDE_ACTIONS } from './actions/registry';
import { canRunActions, runAction, runCustomAction } from './actions/runner';
import { ASSISTANT_NAME } from './constants';
import {
	captureAskContext,
	captureNote,
	captureSelection,
	getEditorTarget,
} from './context/collect';
import type { Attachment } from './context/types';
import type ObsAidePlugin from './main';
import { ActionPickerModal, isCustomAction } from './ui/action-picker';
import { AskAideModal } from './ui/ask-modal';

/** Open Ask Aide with whatever the user is currently looking at. */
export function openAskAide(plugin: ObsAidePlugin, attachments?: Attachment[]): void {
	// Capture the editor before the modal opens: from that point on, focus is on
	// the modal and then on the sidebar, never on the note.
	const target = getEditorTarget(plugin.app);
	const anchor = target ? captureAnchor(target.view) : null;

	new AskAideModal(plugin.app, {
		attachments: attachments ?? captureAskContext(plugin.app),
		onSubmit: (question, chosen) => {
			void (async () => {
				const view = await plugin.activateChatView();
				if (!view) {
					new Notice(`Could not open ${ASSISTANT_NAME}.`);
					return;
				}
				await view.send({
					displayText: question,
					attachments: chosen,
					anchor: anchor ?? undefined,
					anchorView: target?.view ?? null,
				});
			})();
		},
	}).open();
}

export function registerCommands(plugin: ObsAidePlugin): void {
	plugin.addCommand({
		id: 'open-aide',
		name: `Open ${ASSISTANT_NAME}`,
		callback: () => void plugin.activateChatView(),
	});

	plugin.addCommand({
		id: 'ask-aide',
		name: `Ask ${ASSISTANT_NAME}`,
		callback: () => openAskAide(plugin),
	});

	for (const action of AIDE_ACTIONS) {
		plugin.addCommand({
			id: `action-${action.id}`,
			name: action.commandName,
			checkCallback: (checking: boolean) => {
				if (!canRunActions(plugin)) return false;
				if (!checking) void runAction(plugin, action);
				return true;
			},
		});
	}
}

/** Add ObsAIde entries to the editor context menu. */
export function registerEditorMenu(plugin: ObsAidePlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on(
			'editor-menu',
			(menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				const file = info.file ?? null;
				const selection = captureSelection(editor, file, 'primary');
				// The containing note rides along as supporting context so a
				// selection like "its complexity is O(log n)" still has a subject.
				const attachments = selection
					? file
						? [selection, captureNote(file, 'supporting')]
						: [selection]
					: file
						? [captureNote(file, 'primary')]
						: [];

				menu.addItem((item) =>
					item
						.setSection('obsaide')
						.setTitle(
							selection
								? `Ask ${ASSISTANT_NAME} about this`
								: `Ask ${ASSISTANT_NAME} about this note`,
						)
						.setIcon('sparkles')
						.onClick(() => openAskAide(plugin, attachments)),
				);

				menu.addItem((item) =>
					item
						.setSection('obsaide')
						.setTitle(`${ASSISTANT_NAME} actions…`)
						.setIcon('wand-sparkles')
						.onClick(() => {
							new ActionPickerModal(plugin.app, plugin, (action) =>
								isCustomAction(action)
									? void runCustomAction(plugin, action)
									: void runAction(plugin, action),
							).open();
						}),
				);
			},
		),
	);
}
