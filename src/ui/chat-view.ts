import {
	ItemView,
	Menu,
	Notice,
	setIcon,
	setTooltip,
	type Editor,
	type MarkdownView,
	type WorkspaceLeaf,
	TFile,
	TFolder,
} from 'obsidian';
import { AIDE_ICON, ASSISTANT_NAME, CHAT_VIEW_TYPE } from '../constants';
import type { NoteEditAnchor } from '../actions/anchor';
import { captureAnchor } from '../actions/edit-target';
import { AIDE_ACTIONS } from '../actions/registry';
import { describeCustomActionAvailability, runAction, runCustomAction } from '../actions/runner';
import type { ChatController, SendRequest } from '../chat/controller';
import { isEmptyConversation, effectiveContextScope } from '../chat/conversation';
import {
	captureFolder,
	captureNote,
	captureSelection,
	captureSection,
	getEditorTarget,
	isDuplicateAttachment,
} from '../context/collect';
import { resolveLinkedNotes } from '../context/linked-notes-vault';
import type { LinkedNoteCandidate } from '../context/linked-notes';
import { extractCurrentSection } from '../context/section';
import type { Attachment } from '../context/types';
import { getProviderDescriptor } from '../providers/catalog';
import { isProviderConfigured } from '../settings/types';
import { summarize } from '../utils/text';
import { AideHeader } from './header';
import { AttachmentDetailsModal } from './attachment-details';
import { Composer } from './composer';
import { ConversationPickerModal } from './conversation-picker';
import { FolderPickerModal } from './folder-picker';
import { LinkedNotesModal } from './linked-notes-modal';
import { MessageList } from './message-list';
import { NotePickerModal } from './note-picker';
import { QuizFlow } from './quiz-flow';
import { BottomScroller } from './scroller';
import { WikilinkFlow } from './wikilink-flow';
import { NoteFlows } from './note-flows';
import type ObsAidePlugin from '../main';

const STREAM_RENDER_INTERVAL_MS = 90;

/** The Aide sidebar: transcript, composer and provider controls. */
export class AideChatView extends ItemView {
	private controller: ChatController;
	private messageList!: MessageList;
	private composer!: Composer;
	private scroller!: BottomScroller;
	private quizFlow!: QuizFlow;
	private wikilinkFlow!: WikilinkFlow;
	private noteFlows!: NoteFlows;
	private header!: AideHeader;
	private scrollerEl!: HTMLElement;
	private flowEl!: HTMLElement;
	private jumpButton!: HTMLButtonElement;

	private attachments: Attachment[] = [];
	private unsubscribe: (() => void) | null = null;
	private streamTimer: number | null = null;
	private streamPending = false;
	/** Last known editor context (editor, file, view, cursor) for section context when sidebar gains focus. */
	private lastEditorContext: { editor: Editor; file: TFile | null; view: MarkdownView; cursor: { line: number; ch: number } } | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ObsAidePlugin,
	) {
		super(leaf);
		this.controller = plugin.chat;
		this.navigation = false;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return ASSISTANT_NAME;
	}

	override getIcon(): string {
		return AIDE_ICON;
	}

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('obsaide-view');

		// Capture the editor context before the sidebar takes focus
		this.captureLastEditorContext();

		this.header = new AideHeader(root, this.plugin, this.controller, {
			onOpenHistory: () => this.openConversationPicker(),
			onOpenQuizSetup: () => this.quizFlow.open(this.attachments),
			canCreateQuiz: () => this.attachments.length > 0,
			onOpenWikilinkSuggestions: () => void this.wikilinkFlow.open(),
			onExportConversation: () => this.noteFlows.exportConversation(this.controller.current),
		});
		this.buildTranscript(root);
		this.quizFlow = new QuizFlow(this.app, this.plugin);
		this.wikilinkFlow = new WikilinkFlow(this.app, this.plugin);
		this.noteFlows = new NoteFlows(this.app, this.plugin);

		this.composer = new Composer(root, {
			onSend: (text) => void this.send({ displayText: text }),
			onStop: () => this.controller.stop(),
			onAddContext: (anchor) => this.showContextMenu(anchor),
			onOpenActions: (anchor) => this.showActionsMenu(anchor),
			onRemoveAttachment: (id) => {
				this.attachments = this.attachments.filter((item) => item.id !== id);
				this.composer.setAttachments(this.attachments);
			},
			onInspectAttachment: (attachment) => this.inspect(attachment),
			onAddNoteAttachment: (attachment) => {
				this.addAttachment(attachment);
				const file = this.app.vault.getAbstractFileByPath(attachment.path);
				if (file instanceof TFile) this.maybeOfferLinkedNotes([file]);
			},
			onChangeLength: (length) => {
				const settings = this.controller.getSettings();
				settings.responseLength = length;
				void this.controller.saveSettings();
			},
			onChangeScope: (scope) => {
				// The scope is a per-conversation choice; the Settings tab decides
				// what *new* conversations start with.
				this.controller.setContextScope(scope);
				void this.applyScopeContext();
			},
		}, this.app);

		this.unsubscribe = this.controller.onChange((reason) => {
			if (reason === 'stream') {
				this.scheduleStreamRender();
				return;
			}
			// A different transcript is now on screen, so start at the latest
			// message however the previous one was scrolled. Its scope decides
			// what context is attached, applied without opening any picker.
			if (reason === 'conversation') {
				this.scroller.pin();
				void this.applyScopeContext(true);
			}
			void this.renderAll();
		});

		// Re-capture editor context when sidebar regains focus; registered on
		// the view's lifetime so reopening cannot stack duplicate handlers.
		this.registerDomEvent(this.contentEl, 'focusin', () => this.captureLastEditorContext());

		await this.renderAll();
		// Reflect the conversation's scope in the composer from the start,
		// attaching whatever the scope can capture right now.
		void this.applyScopeContext(true);
	}

	/** Capture the current editor context (editor, file, view, cursor) for section context. */
	private captureLastEditorContext(): void {
		const target = getEditorTarget(this.app);
		if (target) {
			this.lastEditorContext = {
				editor: target.editor,
				file: target.file,
				view: target.view,
				cursor: target.editor.getCursor('from'),
			};
		}
	}

	override async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.streamTimer !== null) {
			window.clearInterval(this.streamTimer);
			this.streamTimer = null;
		}
		this.messageList?.destroy();
		this.composer?.destroy();
		this.contentEl.empty();
	}

	/** Queue a turn from outside the view, e.g. from Ask Aide. */
	async send(request: SendRequest): Promise<void> {
		if (this.controller.isGenerating) {
			new Notice(`${ASSISTANT_NAME} is still answering. Stop it first, or wait.`);
			return;
		}
		const attachments = request.attachments ?? this.attachments;
		this.attachments = [];
		this.composer.setAttachments(this.attachments);

		// A plain chat message still records where the user was working, so its
		// reply can be inserted back into that note later.
		const fallback = this.captureAmbientAnchor();
		this.scroller.pin();

		await this.controller.send({
			...request,
			attachments,
			anchor: request.anchor ?? fallback?.anchor,
			anchorView: request.anchorView ?? fallback?.view ?? null,
		});
	}

	addAttachment(attachment: Attachment): void {
		if (isDuplicateAttachment(this.attachments, attachment)) return;
		this.attachments.push(attachment);
		this.composer.setAttachments(this.attachments);
	}

	focusComposer(): void {
		this.composer?.focus();
	}

	/** Where the user was working, for replies that were not started from a note. */
	private captureAmbientAnchor(): { anchor: NoteEditAnchor; view: MarkdownView } | null {
		const target = getEditorTarget(this.app);
		if (!target) return null;
		const anchor = captureAnchor(target.view);
		return anchor ? { anchor, view: target.view } : null;
	}

	// --- layout --------------------------------------------------------------

	private buildTranscript(root: HTMLElement): void {
		const body = root.createDiv({ cls: 'obsaide-body' });
		this.scrollerEl = body.createDiv({ cls: 'obsaide-messages' });
		this.flowEl = this.scrollerEl.createDiv({ cls: 'obsaide-message-flow' });

		this.jumpButton = body.createEl('button', {
			cls: 'obsaide-jump',
			attr: { 'aria-label': 'Jump to latest' },
		});
		setIcon(this.jumpButton, 'arrow-down');
		setTooltip(this.jumpButton, 'Jump to latest');
		this.jumpButton.addEventListener('click', () => this.scroller.pin());

		this.scroller = new BottomScroller(this.scrollerEl, this.flowEl, this, (pinned) => {
			this.jumpButton.toggleClass('is-visible', !pinned);
		});

		this.messageList = new MessageList(this.app, this.flowEl, this, {
			onRegenerate: () => {
				this.scroller.pin();
				void this.controller.regenerate();
			},
			onOpenSettings: () => this.plugin.openSettings(),
			onUseInNote: (message) => this.noteFlows.openReview(message),
			onInsertAtCursor: (message) => void this.noteFlows.insertAtCursor(message),
			onAppendToNote: (message) => void this.noteFlows.appendToNote(message),
			onCreateNote: (message) => void this.noteFlows.createNoteFromReply(message),
			canInsert: (message) => this.noteFlows.resolveTarget(message) !== null,
			onInspectAttachment: (attachment) => this.inspect(attachment),
			onBranchFromMessage: (messageId) => this.controller.branchFromMessage(messageId),
		});
	}

	private inspect(attachment: Attachment): void {
		new AttachmentDetailsModal(this.app, attachment).open();
	}

	private async applyScopeContext(quiet = false): Promise<void> {
		// Clear existing scope-based attachments (keep manual/@note attachments)
		const manualAttachments = this.attachments.filter(
			(a) => a.kind === 'note' || a.kind === 'folder',
		);
		// Note: @note attachments are also 'note' kind but we want to keep them
		// For simplicity, we'll just clear all auto-captured context
		this.attachments = manualAttachments;

		const settings = this.controller.getSettings();
		const scope = effectiveContextScope(this.controller.current, settings.contextScope);
		if (scope === 'none') {
			this.composer.setAttachments(this.attachments);
			this.composer.setScope('none');
			return;
		}

		const target = getEditorTarget(this.app);
		if (!target) {
			this.composer.setAttachments(this.attachments);
			this.composer.setScope(scope, 'no editor');
			return;
		}

		let contextInfo = '';

		if (scope === 'selection') {
			// Nothing selected means nothing is sent for this scope — never swap
			// in the whole note as an unrequested substitute.
			const selection = captureSelection(target.editor, target.file, 'primary');
			if (selection) {
				this.addAttachment(selection);
				if (target.file) {
					this.addAttachment(captureNote(target.file, 'supporting'));
				}
				contextInfo = (selection.text ?? '').length > 0 ? 'selected' : 'none selected';
			} else {
				contextInfo = 'none selected';
			}
		} else if (scope === 'section') {
			// Use preserved editor context if available (captured before sidebar took focus)
			const editorContext = this.lastEditorContext;
			const editor = editorContext?.editor ?? target.editor;
			const file = editorContext?.file ?? target.file;
			const sectionAttach = captureSection(this.app, editor, file, 'primary');
			if (sectionAttach) {
				this.addAttachment(sectionAttach);
				contextInfo = sectionAttach.title || 'section';
			} else {
				contextInfo = 'no section';
			}
		} else if (scope === 'note' && target.file) {
			this.addAttachment(captureNote(target.file, 'primary'));
			contextInfo = target.file.basename;
		} else if (scope === 'linked' && target.file) {
			await this.addLinkedNotes(target.file);
			// Count note attachments added by linked scope (all have role 'primary')
			const linkedNotes = this.attachments.filter(a => a.kind === 'note');
			contextInfo = `${linkedNotes.length}`;
		} else if (scope === 'folder') {
			// A folder attachment from a prior selection is kept (see the
			// `manualAttachments` filter above); otherwise there is nothing to
			// send until the user picks one.
			const hasFolder = this.attachments.some((a) => a.kind === 'folder');
			if (!hasFolder && quiet) {
				// Automatic application never pops a picker mid-conversation;
				// say plainly that nothing will be sent until one is chosen.
				this.composer.setAttachments(this.attachments);
				this.composer.setScope(scope, 'no folder selected');
				return;
			}
			if (!hasFolder) {
				new FolderPickerModal(this.app, (folderSource) => {
					if (folderSource.isRoot) {
						const rootFolder = this.app.vault.getRoot();
						this.addAttachment(captureFolder(this.app, rootFolder));
						this.composer.setAttachments(this.attachments);
						this.composer.setScope(scope, '/');
					} else {
						const folder = this.app.vault.getAbstractFileByPath(folderSource.path);
						if (folder instanceof TFolder) {
							this.addAttachment(captureFolder(this.app, folder));
							this.composer.setAttachments(this.attachments);
							this.composer.setScope(scope, folderSource.name || folderSource.path);
						}
					}
				}).open();
				return;
			}
			const folderAttach = this.attachments.find(a => a.kind === 'folder');
			if (folderAttach) contextInfo = folderAttach.title ?? folderAttach.path ?? 'folder';
		}

		this.composer.setAttachments(this.attachments);
		this.composer.setScope(scope, contextInfo);
	}

	/** Vault paths already covered by the current attachments, so a linked-note offer never repeats them. */
	private attachedPaths(): Set<string> {
		return new Set(this.attachments.map((a) => a.path).filter((p): p is string => !!p));
	}

	/**
	 * Offer any Markdown notes the given note(s) link to, letting the user pick
	 * which ones to attach. A no-op when there are none — never opens an empty
	 * modal. Called once per attach; the notes a user picks here are added
	 * directly and never re-offer their own links, so discovery stays one
	 * level deep.
	 */
	private maybeOfferLinkedNotes(sourceFiles: TFile[]): void {
		const candidates = resolveLinkedNotes(this.app, sourceFiles, this.attachedPaths());
		if (candidates.length === 0) return;
		this.openLinkedNotesModal(candidates);
	}

	private openLinkedNotesModal(candidates: LinkedNoteCandidate[]): void {
		new LinkedNotesModal(this.app, candidates, (chosen) => {
			for (const candidate of chosen) {
				const file = this.app.vault.getAbstractFileByPath(candidate.path);
				if (file instanceof TFile) this.addAttachment(captureNote(file, 'primary'));
			}
			this.composer.setAttachments(this.attachments);
		}).open();
	}

	/** The "Linked notes" scope: union the outgoing links of every attached note. */
	private async addLinkedNotes(fallbackFile: TFile): Promise<void> {
		const attachedNotePaths = this.attachments
			.filter((a) => a.kind === 'note' && a.path)
			.map((a) => a.path!);
		const sourcePaths = attachedNotePaths.length > 0 ? attachedNotePaths : [fallbackFile.path];
		const sourceFiles = sourcePaths
			.map((path) => this.app.vault.getAbstractFileByPath(path))
			.filter((file): file is TFile => file instanceof TFile);

		const candidates = resolveLinkedNotes(this.app, sourceFiles, this.attachedPaths());
		if (candidates.length === 0) {
			new Notice('No linked notes found');
			return;
		}
		this.openLinkedNotesModal(candidates);
	}

	private openConversationPicker(): void {
		const conversations = this.plugin.conversations.list();
		if (conversations.length === 0) {
			new Notice('No conversations yet.');
			return;
		}
		new ConversationPickerModal(this.app, {
			store: this.plugin.conversations,
			onChoose: (conversation) => {
				// Empty conversation object signals "new conversation"
				if (!conversation.id) {
					this.controller.newConversation();
				} else {
					this.controller.openConversation(conversation.id);
				}
			},
			onDelete: (id) => this.controller.deleteConversation(id),
			onRename: (id, newTitle) => this.controller.renameConversation(id, newTitle),
			onBranch: (id) => this.controller.branchFromConversation(id),
			getCurrentConversationId: () => this.controller.current.id,
		}).open();
	}

	// --- context -------------------------------------------------------------

	private showContextMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		const target = getEditorTarget(this.app);
		const activeFile = this.app.workspace.getActiveFile() ?? target?.file ?? null;

		const selection = target ? captureSelection(target.editor, target.file, 'primary') : null;
		menu.addItem((item) =>
			item
				.setTitle('Current selection')
				.setIcon('text-cursor-input')
				.setDisabled(!selection)
				.onClick(() => {
					if (selection) this.addAttachment(selection);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(
					activeFile
						? `Current note: ${summarize(activeFile.basename, 24)}`
						: 'Current note',
				)
				.setIcon('file-text')
				.setDisabled(!activeFile)
				.onClick(() => {
					if (!activeFile) return;
					this.addAttachment(captureNote(activeFile));
					this.maybeOfferLinkedNotes([activeFile]);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Choose a note…')
				.setIcon('search')
				.onClick(() => {
					new NotePickerModal(this.app, (file) => {
						this.addAttachment(captureNote(file));
						this.maybeOfferLinkedNotes([file]);
					}).open();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Choose a folder…')
				.setIcon('folder')
				.onClick(() => {
					new FolderPickerModal(this.app, (folderSource) => {
						if (folderSource.isRoot) {
							const rootFolder = this.app.vault.getRoot();
							this.addAttachment(captureFolder(this.app, rootFolder));
						} else {
							const folder = this.app.vault.getAbstractFileByPath(folderSource.path);
							if (folder instanceof TFolder) {
								this.addAttachment(captureFolder(this.app, folder));
							}
						}
					}).open();
				}),
		);
				if (this.attachments.length > 0) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle('Remove all context')
					.setIcon('x')
					.onClick(() => {
						this.attachments = [];
						this.composer.setAttachments(this.attachments);
					}),
			);
		}

		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	/** Run a built-in or custom action from the composer, without needing the editor context menu. */
	private showActionsMenu(anchor: HTMLElement): void {
		const menu = new Menu();

		menu.addItem((item) => item.setTitle('Built-in').setDisabled(true));
		for (const action of AIDE_ACTIONS) {
			menu.addItem((item) =>
				item
					.setTitle(action.label)
					.setIcon(action.icon)
					.onClick(() => void runAction(this.plugin, action)),
			);
		}

		const customActions = this.plugin.settings.customActions.filter((a) => a.enabled);
		if (customActions.length > 0) {
			menu.addSeparator();
			menu.addItem((item) => item.setTitle('Custom').setDisabled(true));
			for (const action of customActions) {
				const availability = describeCustomActionAvailability(this.plugin, action);
				menu.addItem((item) =>
					item
						.setTitle(
							availability.available ? action.name : `${action.name} — ${availability.reason}`,
						)
						.setIcon(action.icon || 'zap')
						.setDisabled(!availability.available)
						.onClick(() => void runCustomAction(this.plugin, action)),
				);
			}
		}

		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	// --- rendering -----------------------------------------------------------

	private scheduleStreamRender(): void {
		this.streamPending = true;
		if (this.streamTimer !== null) return;
		// Markdown re-rendering is not free, so streaming updates are batched on
		// a fixed interval rather than run per token. The timer is created once
		// per view and idles cheaply between replies.
		this.streamTimer = window.setInterval(() => {
			if (!this.streamPending) return;
			this.streamPending = false;
			const message = this.controller.generatingMessage;
			if (!message) return;
			void this.messageList.updateStreaming(message).then(() => this.scroller.settle());
		}, STREAM_RENDER_INTERVAL_MS);
		this.registerInterval(this.streamTimer);
	}

	private async renderAll(): Promise<void> {
		const conversation = this.controller.current;
		const generatingId = this.controller.generatingMessage?.id ?? null;

		// A rebuild empties the scroller, so the reading position is captured
		// first: following the conversation returns to the bottom, and reading
		// older messages stays put instead of snapping to the top.
		const restoreScroll = this.scroller.preserve();

		this.updateHeader();
		if (isEmptyConversation(conversation)) {
			this.messageList.destroy();
			this.flowEl.empty();
			this.renderEmptyState(this.flowEl);
		} else {
			// Await the Markdown render so scrolling happens against the finished
			// layout, not an empty transcript.
			await this.messageList.render(conversation, generatingId);
		}
		this.composer.setGenerating(this.controller.isGenerating);
		this.composer.setAttachments(this.attachments);

		restoreScroll();
	}

	private updateHeader(): void {
		this.header.update();
		this.composer.setLength(this.header.getEffective().responseLength);

		const settings = this.controller.getSettings();
		const conversation = this.controller.current;

		// Update context scope label
		const scope = effectiveContextScope(conversation, settings.contextScope);
		if (scope === 'none') {
			this.composer.setScope('none');
		} else {
			// Recompute context info for display
			const target = getEditorTarget(this.app);
			let contextInfo = '';
			if (target) {
				if (scope === 'selection') {
					const selection = target.editor.getSelection().trim();
					contextInfo = selection ? 'selected' : 'none selected';
				} else if (scope === 'section' && target.file) {
					const editorContext = this.lastEditorContext;
					const editor = editorContext?.editor ?? target.editor;
					const file = editorContext?.file ?? target.file;
					const result = extractCurrentSection(this.app, editor, file);
					contextInfo = result.section ? result.breadcrumb : 'no section';
				} else if (scope === 'note' && target.file) {
					contextInfo = target.file.basename;
				} else if (scope === 'linked' && target.file) {
					const linkSourcePaths = this.attachments
						.filter((a) => a.kind === 'note' && a.path)
						.map((a) => a.path!);
					const sourcePaths = linkSourcePaths.length > 0 ? linkSourcePaths : [target.file.path];
					const sourceFiles = sourcePaths
						.map((path) => this.app.vault.getAbstractFileByPath(path))
						.filter((f): f is TFile => f instanceof TFile);
					const linkedCount = resolveLinkedNotes(this.app, sourceFiles, this.attachedPaths()).length;
					contextInfo = `${linkedCount}`;
				} else if (scope === 'folder') {
					const folderAttach = this.attachments.find(a => a.kind === 'folder');
					contextInfo = folderAttach?.title || folderAttach?.path || 'no folder';
				}
			} else {
				contextInfo = 'no editor';
			}
			this.composer.setScope(scope, contextInfo);
		}
	}

	private renderEmptyState(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: 'obsaide-empty' });
		const icon = empty.createDiv({ cls: 'obsaide-empty-icon' });
		setIcon(icon, AIDE_ICON);
		empty.createEl('h3', { text: `Ask ${ASSISTANT_NAME}` });

		const providerId = this.controller.providerId;
		if (!isProviderConfigured(this.plugin.settings, providerId)) {
			const descriptor = getProviderDescriptor(providerId);
			empty.createEl('p', {
				cls: 'obsaide-empty-text',
				text: `${this.plugin.providers.label(providerId)} needs to be set up before Aide can answer.`,
			});
			const button = empty.createEl('button', {
				cls: 'obsaide-button is-cta',
				text: 'Open ObsAIde settings',
			});
			button.addEventListener('click', () => this.plugin.openSettings());
			if (descriptor.apiKeyUrl) {
				empty.createEl('p', {
					cls: 'obsaide-empty-hint',
					text: `Get a key at ${descriptor.apiKeyUrl}`,
				});
			}
			return;
		}

		empty.createEl('p', {
			cls: 'obsaide-empty-text',
			text: 'Attach a note or a folder, then ask anything. Nothing from your vault is sent unless you attach it.',
		});

		const suggestions = empty.createDiv({ cls: 'obsaide-suggestions' });
		for (const prompt of [
			'Explain the note I attached',
			'What should I add next to this note?',
			'Teach me this topic step by step',
		]) {
			const chip = suggestions.createEl('button', {
				cls: 'obsaide-suggestion',
				text: prompt,
			});
			chip.addEventListener('click', () => {
				this.composer.setText(prompt);
				this.composer.focus();
			});
		}
	}

}
