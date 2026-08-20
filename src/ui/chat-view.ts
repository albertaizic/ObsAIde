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
import {
	captureAnchor,
	insertAtAnchor,
	resolveEditTarget,
	type ResolvedEditTarget,
} from '../actions/edit-target';
import { AIDE_ACTIONS } from '../actions/registry';
import { describeCustomActionAvailability, runAction, runCustomAction } from '../actions/runner';
import type { ChatController, SendRequest } from '../chat/controller';
import { isEmptyConversation, conversationTitle, type Conversation, type ConversationMessage } from '../chat/conversation';
import { buildConversationExportContent, sanitizeExportName, type ConversationExportMode as ExportMode } from '../chat/export';
import { buildContextBlock } from '../context/resolve';
import {
	captureFolder,
	captureNote,
	captureSelection,
	captureSection,
	getEditorTarget,
	isDuplicateAttachment,
} from '../context/collect';
import { buildSystemPrompt } from '../prompts/system';
import { resolveLinkedNotes } from '../context/linked-notes-vault';
import type { LinkedNoteCandidate } from '../context/linked-notes';
import { extractCurrentSection } from '../context/section';
import { describeScopeStatus } from '../context/status';
import type { Attachment } from '../context/types';
import { getProviderDescriptor } from '../providers/catalog';
import { isProviderConfigured, type ContextScope } from '../settings/types';
import { summarize } from '../utils/text';
import { AttachmentDetailsModal } from './attachment-details';
import { Composer } from './composer';
import { ConversationExportModal } from './export-modal';
import { ConversationPickerModal } from './conversation-picker';
import { EditPreviewModal } from './edit-preview';
import { FolderPickerModal } from './folder-picker';
import { LinkedNotesModal } from './linked-notes-modal';
import { MessageList } from './message-list';
import { NotePickerModal } from './note-picker';
import { PromptModal } from './prompt-modal';
import { QuizNoteModal, type QuizNoteOptions } from './quiz-note-modal';
import { WikilinkSuggestionsModal } from './wikilink-suggestions-modal';
import { BottomScroller } from './scroller';
import { discoverCandidates, generateSuggestions, filterExistingLinks } from '../context/wikilink-suggestions';
import type ObsAidePlugin from '../main';

const STREAM_RENDER_INTERVAL_MS = 90;

/** The Aide sidebar: transcript, composer and provider controls. */
export class AideChatView extends ItemView {
	private controller: ChatController;
	private messageList!: MessageList;
	private composer!: Composer;
	private scroller!: BottomScroller;
	private profileButton!: HTMLButtonElement;
	private providerModelButton!: HTMLButtonElement;
	private modeBadge!: HTMLElement;
	private scrollerEl!: HTMLElement;
	private flowEl!: HTMLElement;
	private jumpButton!: HTMLButtonElement;
	private conversationTitleEl!: HTMLElement;

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

		this.buildHeader(root);
		this.buildTranscript(root);

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
				const settings = this.controller.getSettings();
				settings.contextScope = scope;
				void this.controller.saveSettings();
				void this.applyScopeContext();
			},
		}, this.app);

		this.unsubscribe = this.controller.onChange((reason) => {
			if (reason === 'stream') {
				this.scheduleStreamRender();
				return;
			}
			// A different transcript is now on screen, so start at the latest
			// message however the previous one was scrolled.
			if (reason === 'conversation') this.scroller.pin();
			void this.renderAll();
		});

		// Re-capture editor context when sidebar regains focus
		this.contentEl.addEventListener('focusin', () => this.captureLastEditorContext());

		await this.renderAll();
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
			onUseInNote: (message) => this.openReview(message),
			onInsertAtCursor: (message) => void this.insertAtCursor(message),
			onAppendToNote: (message) => void this.appendToNote(message),
			onCreateNote: (message) => void this.createNoteFromReply(message),
			canInsert: (message) => this.resolveTarget(message) !== null,
			onInspectAttachment: (attachment) => this.inspect(attachment),
			onBranchFromMessage: (messageId) => this.controller.branchFromMessage(messageId),
		});
	}

	private buildHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'obsaide-header' });

		// Row 1: Title + primary actions
		const titleRow = header.createDiv({ cls: 'obsaide-header-title-row' });
		titleRow.createEl('h2', { cls: 'obsaide-header-title', text: ASSISTANT_NAME });

		const titleActions = titleRow.createDiv({ cls: 'obsaide-header-title-actions' });

		const newChat = titleActions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'New conversation' },
		});
		setIcon(newChat, 'plus');
		setTooltip(newChat, 'New conversation');
		newChat.addEventListener('click', () => this.controller.newConversation());

		const historyBtn = titleActions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'Recent conversations' },
		});
		setIcon(historyBtn, 'history');
		setTooltip(historyBtn, 'Recent conversations');
		historyBtn.addEventListener('click', () => this.openConversationPicker());

		const more = titleActions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'More options' },
		});
		setIcon(more, 'more-vertical');
		setTooltip(more, 'More options');
		more.addEventListener('click', (event) => this.showOverflowMenu(event));

		// Conversation title (shows when not empty)
		this.conversationTitleEl = header.createDiv({ cls: 'obsaide-conversation-title' });
		this.conversationTitleEl.setAttribute('aria-live', 'polite');

		// Row 2: Profile + Provider/Model compact row
		const runtimeRow = header.createDiv({ cls: 'obsaide-header-runtime' });

		// Profile selector
		this.profileButton = runtimeRow.createEl('button', { cls: 'obsaide-select is-profile' });
		this.profileButton.addEventListener('click', () => this.showProfileMenu());

		// Provider/Model combined selector
		this.providerModelButton = runtimeRow.createEl('button', { cls: 'obsaide-select is-provider-model' });
		this.providerModelButton.addEventListener('click', () => { void this.showProviderModelMenu(); });

		// Mode badge (tutor mode indicator)
		this.modeBadge = runtimeRow.createSpan({ cls: 'obsaide-mode-badge', text: 'Tutor' });
	}

	// --- note insertion ------------------------------------------------------

	private resolveTarget(message: ConversationMessage): ResolvedEditTarget | null {
		return resolveEditTarget(
			this.app,
			message.anchor,
			this.plugin.editTargets.recall(message.id),
		);
	}

	private openReview(message: ConversationMessage): void {
		new EditPreviewModal(this.app, {
			proposedText: message.text,
			anchor: message.anchor,
			replacesAnchor: message.replacesAnchor,
			preferredView: this.plugin.editTargets.recall(message.id),
		}).open();
	}

	private async insertAtCursor(message: ConversationMessage): Promise<void> {
		const target = this.resolveTarget(message);
		if (!target) {
			new Notice(
				message.anchor
					? `Open “${message.anchor.path}” to insert this reply.`
					: 'This reply is not linked to a note. Copy it instead.',
			);
			return;
		}
		try {
			await insertAtAnchor(this.app, target, message.text);
			new Notice('Inserted at the cursor. Undo with Ctrl/Cmd+Z if needed.');
		} catch {
			new Notice('Could not write to the note.');
		}
	}

	/** Append the reply to an existing note. */
	private appendToNote(message: ConversationMessage): void {
		new NotePickerModal(this.app, (file) => {
			void (async () => {
				try {
					const content = await this.app.vault.cachedRead(file);
					const separator = content.endsWith('\n') ? '' : '\n';
					await this.app.vault.modify(file, `${content}${separator}\n\n---\n\n${message.text}`);
					new Notice(`Appended to ${file.basename}`);
					// Optionally open the note
					const leaf = this.app.workspace.getLeaf(false);
					if (leaf) await leaf.openFile(file);
				} catch {
					new Notice('Could not append to the note.');
				}
			})();
		}).open();
	}

	/** Create a new note with the reply as content. */
	private createNoteFromReply(message: ConversationMessage): void {
		new PromptModal(this.app, {
			title: 'Create new note',
			description: 'Enter a name for the new note (without .md extension)',
			placeholder: 'My AI Response',
			submitText: 'Create',
			onSubmit: (name) => {
				void (async () => {
					const trimmed = name.trim();
					if (!trimmed) {
						new Notice('Please enter a note name.');
						return;
					}
					// Sanitize filename
					const sanitized = trimmed.replace(/[<>:"/\\|?*]/g, '-');
					const folder = this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
					let path = `${folder.path}/${sanitized}.md`;
					// Ensure unique path
					let counter = 1;
					let finalPath = path;
					while (this.app.vault.getAbstractFileByPath(finalPath)) {
						finalPath = `${folder.path}/${sanitized} ${counter}.md`;
						counter++;
					}
					try {
						const file = await this.app.vault.create(finalPath, message.text);
						new Notice(`Created ${file.basename}`);
						const leaf = this.app.workspace.getLeaf(false);
						if (leaf) await leaf.openFile(file);
					} catch {
						new Notice('Could not create the note.');
					}
				})();
			},
		}).open();
	}

	private inspect(attachment: Attachment): void {
		new AttachmentDetailsModal(this.app, attachment).open();
	}

	// --- menus ---------------------------------------------------------------

	private updateProfileButton(): void {
		const activeProfile = this.plugin.profiles.getActive();
		this.profileButton.setText(activeProfile.name);
		setTooltip(this.profileButton, `Profile: ${activeProfile.name}. Click to change.`);
	}

	private showProfileMenu(): void {
		const menu = new Menu();
		const profiles = this.plugin.profiles.getEnabled();

		for (const profile of profiles) {
			menu.addItem((item) =>
				item
					.setTitle(profile.name)
					.setIcon(profile.icon)
					.setChecked(profile.id === this.plugin.profiles.getActive().id)
					.onClick(async () => {
						await this.plugin.profiles.setActive(profile.id);
						this.updateProfileButton();
					}),
			);
		}

		const rect = this.profileButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private async showProviderModelMenu(): Promise<void> {
		const menu = new Menu();
		const settings = this.plugin.settings;
		const available = this.plugin.providers.availableProviders();

		// Provider section
		if (available.length === 0) {
			menu.addItem((item) => item.setTitle('No providers enabled').setDisabled(true));
		} else {
			menu.addItem((item) => item.setTitle('Provider').setDisabled(true));
			for (const id of available) {
				const configured = isProviderConfigured(settings, id);
				menu.addItem((item) =>
					item
						.setTitle(
							configured
								? this.plugin.providers.label(id)
								: `${this.plugin.providers.label(id)} — not configured`,
						)
						.setChecked(id === settings.defaultProvider)
						.onClick(() => void this.controller.setProvider(id)),
				);
			}
		}

		menu.addSeparator();

		// Model section (for current provider)
		menu.addItem((item) => item.setTitle('Model').setDisabled(true));
		const providerId = this.controller.providerId;
		const currentModel = this.controller.model;

		try {
			const modelInfos = await this.plugin.providers.listModels(providerId);
			const models = modelInfos.map(m => m.id);

			for (const model of models) {
				menu.addItem((item) =>
					item
						.setTitle(model)
						.setChecked(model === currentModel)
						.onClick(() => void this.controller.setModel(model)),
				);
			}

			if (models.length === 0) {
				menu.addItem((item) => item.setTitle('No models available').setDisabled(true));
			}
		} catch {
			menu.addItem((item) => item.setTitle('Failed to load models').setDisabled(true));
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Configure providers…')
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);

		const rect = this.providerModelButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	/**
	 * What this scope will actually send, right now — never an ambiguous label.
	 * Selection with nothing selected must read as empty, not silently swap in
	 * unrelated context; Section must reflect the last known editor cursor, not
	 * fall back to the whole note.
	 */
	private computeScopeStatusText(scope: ContextScope): string {
		const target = getEditorTarget(this.app);
		const editorContext = this.lastEditorContext;
		const editor = target?.editor ?? editorContext?.editor ?? null;
		const file = target?.file ?? editorContext?.file ?? null;
		const hasEditor = editor !== null && file !== null;

		const hasSelection = editor !== null && editor.getSelection().trim().length > 0;

		let sectionBreadcrumb: string | null = null;
		if (editor && file) {
			const result = extractCurrentSection(this.app, editor, file);
			sectionBreadcrumb = result.section ? result.breadcrumb : null;
		}

		const attachedNotePaths = this.attachments
			.filter((a) => a.kind === 'note' && a.path)
			.map((a) => a.path!);
		const linkSourcePaths = attachedNotePaths.length > 0 ? attachedNotePaths : file ? [file.path] : [];
		const linkSourceFiles = linkSourcePaths
			.map((path) => this.app.vault.getAbstractFileByPath(path))
			.filter((f): f is TFile => f instanceof TFile);
		const linkedCount =
			linkSourceFiles.length > 0
				? resolveLinkedNotes(this.app, linkSourceFiles, this.attachedPaths()).length
				: 0;

		const folderPath = this.attachments.find((a) => a.kind === 'folder')?.path ?? null;

		return describeScopeStatus({
			scope,
			hasEditor,
			hasSelection,
			activeFileName: file?.basename ?? null,
			sectionBreadcrumb,
			linkedCount,
			folderPath,
		});
	}

	private async applyScopeContext(): Promise<void> {
		// Clear existing scope-based attachments (keep manual/@note attachments)
		const manualAttachments = this.attachments.filter(
			(a) => a.kind === 'note' || a.kind === 'folder',
		);
		// Note: @note attachments are also 'note' kind but we want to keep them
		// For simplicity, we'll just clear all auto-captured context
		this.attachments = manualAttachments;

		const scope = this.controller.getSettings().contextScope ?? 'selection';
		if (scope === 'none') {
			this.composer.setAttachments(this.attachments);
			return;
		}

		const target = getEditorTarget(this.app);
		if (!target) {
			this.composer.setAttachments(this.attachments);
			return;
		}

		if (scope === 'selection') {
			// Nothing selected means nothing is sent for this scope — never swap
			// in the whole note as an unrequested substitute.
			const selection = captureSelection(target.editor, target.file, 'primary');
			if (selection) {
				this.addAttachment(selection);
				if (target.file) {
					this.addAttachment(captureNote(target.file, 'supporting'));
				}
			}
		} else if (scope === 'section') {
			// Use preserved editor context if available (captured before sidebar took focus)
			const editorContext = this.lastEditorContext;
			const editor = editorContext?.editor ?? target.editor;
			const file = editorContext?.file ?? target.file;
			const sectionAttach = captureSection(this.app, editor, file, 'primary');
			if (sectionAttach) this.addAttachment(sectionAttach);
		} else if (scope === 'note' && target.file) {
			this.addAttachment(captureNote(target.file, 'primary'));
		} else if (scope === 'linked' && target.file) {
			await this.addLinkedNotes(target.file);
		} else if (scope === 'folder') {
			// A folder attachment from a prior selection is kept (see the
			// `manualAttachments` filter above); otherwise there is nothing to
			// send until the user picks one.
			const hasFolder = this.attachments.some((a) => a.kind === 'folder');
			if (!hasFolder) {
				new FolderPickerModal(this.app, (folder) => {
					this.addAttachment(captureFolder(this.app, folder));
					this.composer.setAttachments(this.attachments);
					this.composer.setScope(scope);
				}).open();
			}
		}

		this.composer.setAttachments(this.attachments);
		this.composer.setScope(scope);
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

	private showOverflowMenu(event: MouseEvent): void {
		const menu = new Menu();
		const conversation = this.controller.current;

		menu.addItem((item) =>
			item
				.setTitle('New conversation')
				.setIcon('plus')
				.onClick(() => this.controller.newConversation()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Recent conversations…')
				.setIcon('history')
				.onClick(() => this.openConversationPicker()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Tutor mode')
				.setIcon('graduation-cap')
				.setChecked(conversation.mode === 'tutor')
				.onClick(() =>
					this.controller.setMode(conversation.mode === 'tutor' ? 'chat' : 'tutor'),
				),
		);
		menu.addItem((item) =>
			item
				.setTitle('Create quiz note…')
				.setIcon('help-circle')
				.setDisabled(this.controller.isGenerating || this.attachments.length === 0)
				.onClick(() => this.openQuizNoteSetup()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Suggest wikilinks…')
				.setIcon('link-2')
				.setDisabled(this.controller.isGenerating)
				.onClick(() => this.openWikilinkSuggestions()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Save conversation as note…')
				.setIcon('file-down')
				.onClick(() => this.exportConversation(conversation)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Clear conversation')
				.setIcon('eraser')
				.onClick(() => this.controller.clearConversation()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Delete conversation')
				.setIcon('trash')
				.onClick(() => this.controller.deleteConversation(conversation.id)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('ObsAIde settings')
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);
		menu.showAtMouseEvent(event);
	}

	private openConversationPicker(): void {
		const conversations = this.plugin.conversations.list();
		if (conversations.length === 0) {
			new Notice('No conversations yet.');
			return;
		}
		new ConversationPickerModal(this.app, {
			conversations,
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
			currentConversationId: this.controller.current.id,
		}).open();
	}

	private openQuizNoteSetup(): void {
		const modal = new QuizNoteModal(this.app, this.attachments, async (options) => {
			const success = await this.generateQuizNote(options);
			if (success) {
				modal.close();
			} else {
				// Re-enable the modal controls on failure
				modal.setLoading(false);
			}
		});
		modal.open();
	}

	private async openWikilinkSuggestions(): Promise<void> {
		// Get the active file
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('Open a Markdown note to suggest wikilinks.');
			return;
		}

		// Get the text content - use selection if available, otherwise use the note content
		const target = getEditorTarget(this.app);
		let sourceText = '';
		if (target && target.editor.getSelection().trim().length > 0) {
			sourceText = target.editor.getSelection();
		} else {
			// Use the note content (we'll read it)
			try {
				sourceText = await this.app.vault.cachedRead(activeFile);
			} catch {
				new Notice('Could not read the note.');
				return;
			}
		}

		if (!sourceText.trim()) {
			new Notice('The note is empty.');
			return;
		}

		await this.showWikilinkSuggestions(activeFile, sourceText);
	}

	private async showWikilinkSuggestions(file: TFile, sourceText: string): Promise<void> {
		// Show loading notice immediately
		new Notice('Finding wikilinks…');

		try {
			// Discover candidates from the vault
			const candidates = await discoverCandidates(this.app, sourceText);
			if (candidates.length === 0) {
				new Notice('No matching notes found in the vault.');
				return;
			}

			// Filter out already linked notes
			const filteredCandidates = filterExistingLinks(candidates, sourceText);

			// Generate suggestions
			const suggestions = generateSuggestions(sourceText, filteredCandidates);
			if (suggestions.length === 0) {
				new Notice('No useful wikilinks found.');
				return;
			}

			// Show the modal
			const modal = new WikilinkSuggestionsModal(this.app, {
				sourceText,
				file,
				onApply: (newText) => void this.applyWikilinks(file, newText),
			});
			modal.setSuggestions(suggestions);
			modal.open();
		} catch (error) {
			new Notice('Wikilink suggestion failed: ' + String(error));
		}
	}

	private async applyWikilinks(file: TFile, newText: string): Promise<void> {
		try {
			await this.app.vault.modify(file, newText);
			new Notice('Wikilinks applied.');
			// Optionally open the note
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) await leaf.openFile(file);
		} catch {
			new Notice('Could not apply wikilinks.');
		}
	}

	/**
	 * Export the current conversation as a Markdown note.
	 *
	 * Name, folder and what to include are all decided in one modal before
	 * "Export" is pressed — there is no follow-up question after that.
	 */
	private exportConversation(conversation: Conversation): void {
		const defaultFolder = this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
		new ConversationExportModal(this.app, {
			defaultName: conversation.title || 'Conversation Export',
			defaultFolder: defaultFolder.path,
			onExport: ({ name, folder, mode }) => this.writeConversationNote(conversation, name, folder, mode),
		}).open();
	}

	private writeConversationNote(
		conversation: Conversation,
		name: string,
		folderPath: string,
		mode: ExportMode,
	): void {
		const sanitized = sanitizeExportName(name);
		const resolvedFolder = folderPath.trim()
			? this.app.vault.getAbstractFileByPath(folderPath.trim())
			: null;
		const folder = resolvedFolder instanceof TFolder ? resolvedFolder : this.app.vault.getRoot();
		let counter = 1;
		let finalPath = `${folder.path}/${sanitized}.md`;
		while (this.app.vault.getAbstractFileByPath(finalPath)) {
			finalPath = `${folder.path}/${sanitized} ${counter}.md`;
			counter++;
		}

		// Use the final unique filename (without .md) as the title in the exported note
		const finalName = finalPath.split(/[/\\]/).pop()?.replace(/\.md$/, '') ?? sanitized;
		const content = buildConversationExportContent(conversation, finalName, mode);

		void this.app.vault.create(finalPath, content).then(async (file) => {
			new Notice(`Exported to ${file.basename}`);
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) await leaf.openFile(file);
		}).catch(() => {
			new Notice('Could not create the note.');
		});
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
					new FolderPickerModal(this.app, (folder) =>
						this.addAttachment(captureFolder(this.app, folder)),
					).open();
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
		const providerId = this.controller.providerId;
		const configured = isProviderConfigured(this.plugin.settings, providerId);
		const label = this.plugin.providers.label(providerId);
		const model = this.controller.model || 'Choose a model';

		// Update conversation title
		const conversation = this.controller.current;
		const title = conversationTitle(conversation);
		this.conversationTitleEl.setText(title || 'New conversation');
		this.conversationTitleEl.toggleClass('is-empty', !title);

		// Update profile button
		this.updateProfileButton();

		// Update combined provider/model button
		const modelShort = summarize(model, 20);
		this.providerModelButton.setText(`${label} · ${modelShort}`);
		setTooltip(this.providerModelButton, `Provider: ${label}\nModel: ${model}. Click to change.`);
		this.providerModelButton.toggleClass('is-unconfigured', !configured);

		this.modeBadge.toggleClass('is-visible', conversation.mode === 'tutor');
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

	/**
	 * Generate a quiz note from the current context and create it as a Markdown file.
	 * Returns true on success, false on failure.
	 */
	private async generateQuizNote(options: QuizNoteOptions): Promise<boolean> {
		const settings = this.controller.getSettings();
		const providerId = settings.defaultProvider;
		const model = settings.providers[providerId].model;

		// Build context block from attachments
		let contextBlock = '';
		if (options.attachments.length > 0) {
			const { block } = await buildContextBlock(this.plugin.app, options.attachments, {
				maxCharsPerNote: settings.maxCharsPerNote,
				maxContextChars: settings.maxContextChars,
			});
			contextBlock = block;
		}

		if (!contextBlock) {
			new Notice('No context available for quiz generation.');
			return false;
		}

		// Build the system prompt
		const activeProfile = this.plugin.profiles.getActive();
		const systemPrompt = buildSystemPrompt({
			mode: 'chat',
			customInstructions: settings.customInstructions,
			responseLength: settings.responseLength,
			profileInstructions: activeProfile.instructions,
		});

		// Build the quiz generation prompt
		const difficultyInstruction = this.getDifficultyInstruction(options.difficulty);
		const typeInstruction = this.getTypeInstruction(options.type);
		const answerKeyInstruction = options.includeAnswerKey
			? 'Include an "Answer Key" section at the end with answers to all questions.'
			: 'Do NOT include answers. Questions only.';

		const userPrompt = `${contextBlock}\n\nGenerate a study quiz based ONLY on the provided context.\n\nRequirements:\n- ${options.questionCount} questions\n- ${difficultyInstruction}\n- ${typeInstruction}\n- ${answerKeyInstruction}\n- Use clear Markdown formatting\n- Ground every question in the provided context — do not invent material\n- If the context is insufficient for a question, skip that topic\n\nOutput only the quiz as Markdown.`;

		try {
			const result = await this.plugin.providers.complete({
				providerId,
				model,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
			});

			const quizContent = result.text.trim();
			if (!quizContent) {
				new Notice('Quiz generation returned empty content.');
				return false;
			}

			// Add frontmatter
			const frontmatter = `---\ncreated: ${new Date().toISOString().split('T')[0]}\nsource: ObsAIde\ntype: quiz\n---\n\n`;
			const fullContent = frontmatter + quizContent;

			// Create the note
			const folderPath = options.folderPath.trim();
			const resolvedFolder = folderPath
				? this.app.vault.getAbstractFileByPath(folderPath)
				: null;
			const folder = resolvedFolder instanceof TFolder ? resolvedFolder : this.app.vault.getRoot();

			const sanitized = options.name.replace(/[<>:"/\\|?*]/g, '-');
			let counter = 1;
			let finalPath = `${folder.path}/${sanitized}.md`;
			while (this.app.vault.getAbstractFileByPath(finalPath)) {
				finalPath = `${folder.path}/${sanitized} ${counter}.md`;
				counter++;
			}

			const file = await this.app.vault.create(finalPath, fullContent);
			new Notice(`Created quiz: ${file.basename}`);
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) await leaf.openFile(file);
			return true;
		} catch (error) {
			new Notice('Quiz generation failed: ' + String(error));
			return false;
		}
	}

	private getDifficultyInstruction(difficulty: QuizNoteOptions['difficulty']): string {
		switch (difficulty) {
			case 'easy':
				return 'Difficulty: Easy — foundational questions about definitions and key concepts';
			case 'medium':
				return 'Difficulty: Medium — questions requiring explanation, application, or connecting concepts';
			case 'hard':
				return 'Difficulty: Hard — questions requiring synthesis, analysis, or identifying subtle distinctions';
			case 'mixed':
			default:
				return 'Difficulty: Mixed — vary between easy, medium, and hard questions';
		}
	}

	private getTypeInstruction(type: QuizNoteOptions['type']): string {
		switch (type) {
			case 'short-answer':
				return 'Format: Short answer — open-ended questions';
			case 'multiple-choice':
				return 'Format: Multiple choice — provide 4 options (A, B, C, D) with each question';
			case 'mixed':
			default:
				return 'Format: Mixed — alternate between short answer and multiple choice';
		}
	}
}
