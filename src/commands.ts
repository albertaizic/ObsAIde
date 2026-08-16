import { Notice, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import { AIDE_ACTIONS } from './actions/registry';
import { canRunActions, runAction } from './actions/runner';
import { ASSISTANT_NAME } from './constants';
import { captureNote, captureSelection, getEditorTarget } from './context/collect';
import type { Attachment } from './context/types';
import type ObsAidePlugin from './main';
import { ActionPickerModal } from './ui/action-picker';
import { AskAideModal } from './ui/ask-modal';

/**
 * Gather the context Ask Aide should start from.
 *
 * A selection wins over the whole note, because it is the more specific thing
 * the user pointed at. When there is no editor at all the modal simply opens
 * with no context.
 */
function captureAskContext(plugin: ObsAidePlugin): Attachment[] {
	const target = getEditorTarget(plugin.app);
	if (target) {
		const selection = captureSelection(target.editor, target.file);
		if (selection) return [selection];
		if (target.file) return [captureNote(target.file)];
	}
	const activeFile = plugin.app.workspace.getActiveFile();
	return activeFile ? [captureNote(activeFile)] : [];
}

/** Open Ask Aide with whatever the user is currently looking at. */
export function openAskAide(plugin: ObsAidePlugin, attachments?: Attachment[]): void {
	new AskAideModal(plugin.app, {
		attachments: attachments ?? captureAskContext(plugin),
		onSubmit: (question, chosen) => {
			void (async () => {
				const view = await plugin.activateChatView();
				if (!view) {
					new Notice(`Could not open ${ASSISTANT_NAME}.`);
					return;
				}
				await view.send({ displayText: question, attachments: chosen });
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
				const selection = captureSelection(editor, file);
				const attachments = selection ? [selection] : file ? [captureNote(file)] : [];

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
							new ActionPickerModal(plugin.app, (action) =>
								void runAction(plugin, action),
							).open();
						}),
				);
			},
		),
	);
}
