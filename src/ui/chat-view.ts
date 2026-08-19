import {
	ItemView,
	Menu,
	Notice,
	setIcon,
	setTooltip,
	type MarkdownView,
	type WorkspaceLeaf,
	TFile,
} from 'obsidian';
import { AIDE_ICON, ASSISTANT_NAME, CHAT_VIEW_TYPE } from '../constants';
import type { NoteEditAnchor } from '../actions/anchor';
import {
	captureAnchor,
	insertAtAnchor,
	resolveEditTarget,
	type ResolvedEditTarget,
} from '../actions/edit-target';
import type { ChatController, SendRequest } from '../chat/controller';
import { isEmptyConversation, type Conversation, type ConversationMessage } from '../chat/conversation';
import {
	captureFolder,
	captureNote,
	captureSelection,
	captureSection,
	getEditorTarget,
	isDuplicateAttachment,
} from '../context/collect';
import type { Attachment } from '../context/types';
import { getProviderDescriptor } from '../providers/catalog';
import { isProviderConfigured, type ContextScope } from '../settings/types';
import { summarize } from '../utils/text';
import { AttachmentDetailsModal } from './attachment-details';
import { Composer } from './composer';
import { ConversationPickerModal } from './conversation-picker';
import { EditPreviewModal } from './edit-preview';
import { FolderPickerModal } from './folder-picker';
import { MessageList } from './message-list';
import { ModelPickerModal } from './model-picker';
import { NotePickerModal } from './note-picker';
import { PromptModal } from './prompt-modal';
import { BottomScroller } from './scroller';
import type ObsAidePlugin from '../main';

const STREAM_RENDER_INTERVAL_MS = 90;

/** The Aide sidebar: transcript, composer and provider controls. */
export class AideChatView extends ItemView {
	private controller: ChatController;
	private messageList!: MessageList;
	private composer!: Composer;
	private scroller!: BottomScroller;
	private providerButton!: HTMLButtonElement;
	private modelButton!: HTMLButtonElement;
	private lengthButton!: HTMLButtonElement;
	private scopeButton!: HTMLButtonElement;
	private modeBadge!: HTMLElement;
	private scrollerEl!: HTMLElement;
	private flowEl!: HTMLElement;
	private jumpButton!: HTMLButtonElement;

	private attachments: Attachment[] = [];
	private unsubscribe: (() => void) | null = null;
	private streamTimer: number | null = null;
	private streamPending = false;

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

		this.buildHeader(root);
		this.buildTranscript(root);

		this.composer = new Composer(root, {
			onSend: (text) => void this.send({ displayText: text }),
			onStop: () => this.controller.stop(),
			onAddContext: (anchor) => this.showContextMenu(anchor),
			onRemoveAttachment: (id) => {
				this.attachments = this.attachments.filter((item) => item.id !== id);
				this.composer.setAttachments(this.attachments);
			},
			onInspectAttachment: (attachment) => this.inspect(attachment),
			onAddNoteAttachment: (attachment) => this.addAttachment(attachment),
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

		await this.renderAll();
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
		});
	}

	private buildHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'obsaide-header' });

		const selectors = header.createDiv({ cls: 'obsaide-selectors' });
		this.providerButton = selectors.createEl('button', { cls: 'obsaide-select' });
		this.providerButton.addEventListener('click', () => this.showProviderMenu());
		this.modelButton = selectors.createEl('button', { cls: 'obsaide-select is-model' });
		this.modelButton.addEventListener('click', () => this.openModelPicker());

		// Response length selector
		this.lengthButton = selectors.createEl('button', { cls: 'obsaide-select is-length' });
		this.lengthButton.addEventListener('click', () => this.showLengthMenu());

		// Context scope selector
		this.scopeButton = selectors.createEl('button', { cls: 'obsaide-select is-scope' });
		this.scopeButton.addEventListener('click', () => this.showScopeMenu());

		const actions = header.createDiv({ cls: 'obsaide-header-actions' });
		this.modeBadge = actions.createSpan({ cls: 'obsaide-mode-badge', text: 'Tutor' });

		const newChat = actions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'New conversation' },
		});
		setIcon(newChat, 'plus');
		setTooltip(newChat, 'New conversation');
		newChat.addEventListener('click', () => this.controller.newConversation());

		const more = actions.createEl('button', {
			cls: 'obsaide-icon-button',
			attr: { 'aria-label': 'More options' },
		});
		setIcon(more, 'more-vertical');
		setTooltip(more, 'More options');
		more.addEventListener('click', (event) => this.showOverflowMenu(event));
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

	private showProviderMenu(): void {
		const settings = this.plugin.settings;
		const menu = new Menu();
		const available = this.plugin.providers.availableProviders();

		if (available.length === 0) {
			menu.addItem((item) => item.setTitle('No providers enabled').setDisabled(true));
		}
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
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Configure providers…')
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);

		const rect = this.providerButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private openModelPicker(): void {
		const providerId = this.controller.providerId;
		new ModelPickerModal(
			this.app,
			this.plugin.providers,
			providerId,
			this.controller.model,
			(model) => void this.controller.setModel(model),
		).open();
	}

	private showLengthMenu(): void {
		const menu = new Menu();
		const currentLength = this.controller.getSettings().responseLength ?? 'normal';

		for (const [value, label] of [
			['short', 'Short'],
			['normal', 'Normal'],
			['detailed', 'Detailed'],
		] as const) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(value === currentLength)
					.onClick(async () => {
						const settings = this.controller.getSettings();
						settings.responseLength = value;
						await this.controller.saveSettings();
						this.updateLengthButton();
					}),
			);
		}

		const rect = this.lengthButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private updateLengthButton(): void {
		const settings = this.controller.getSettings();
		const length = settings.responseLength ?? 'normal';
		const labels: Record<string, string> = { short: 'Short', normal: 'Normal', detailed: 'Detailed' };
		this.lengthButton.setText(labels[length] ?? 'Normal');
		setTooltip(this.lengthButton, `Response length: ${labels[length]}. Click to change.`);
	}

	private showScopeMenu(): void {
		const menu = new Menu();
		const currentScope = this.controller.getSettings().contextScope ?? 'selection';

		const scopes: [ContextScope, string][] = [
			['none', 'None'],
			['selection', 'Selection'],
			['section', 'Section'],
			['note', 'Note'],
			['linked', 'Linked notes'],
			['folder', 'Folder'],
		];

		for (const [value, label] of scopes) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(value === currentScope)
					.onClick(async () => {
						const settings = this.controller.getSettings();
						settings.contextScope = value;
						await this.controller.saveSettings();
						this.updateScopeButton();
						// Apply the scope context immediately
						await this.applyScopeContext();
					}),
			);
		}

		const rect = this.scopeButton.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private updateScopeButton(): void {
		const settings = this.controller.getSettings();
		const scope = settings.contextScope ?? 'selection';
		const labels: Record<string, string> = {
			none: 'None',
			selection: 'Selection',
			section: 'Section',
			note: 'Note',
			linked: 'Linked notes',
			folder: 'Folder',
		};
		this.scopeButton.setText(labels[scope] ?? 'Selection');
		setTooltip(this.scopeButton, `Context scope: ${labels[scope]}. Click to change.`);
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
			const selection = captureSelection(target.editor, target.file, 'primary');
			if (selection) {
				this.addAttachment(selection);
				if (target.file) {
					this.addAttachment(captureNote(target.file, 'supporting'));
				}
			} else if (target.file) {
				this.addAttachment(captureNote(target.file, 'primary'));
			}
		} else if (scope === 'section') {
			const sectionAttach = captureSection(this.app, target.editor, target.file, 'primary');
			if (sectionAttach) this.addAttachment(sectionAttach as unknown as Attachment);
		} else if (scope === 'note' && target.file) {
			this.addAttachment(captureNote(target.file, 'primary'));
		} else if (scope === 'linked' && target.file) {
			await this.addLinkedNotes(target.file);
		} else if (scope === 'folder') {
			// Folder picker would need to be opened - for now just notify
			new Notice('Select a folder from the context menu');
		}

		this.composer.setAttachments(this.attachments);
	}

	private async addLinkedNotes(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.links) return;

		const linkedFiles: TFile[] = [];
		for (const link of cache.links) {
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
			if (linkedFile instanceof TFile && linkedFile.extension === 'md') {
				linkedFiles.push(linkedFile);
			}
		}

		if (linkedFiles.length === 0) {
			new Notice('No linked Markdown notes found');
			return;
		}

		// Show picker for linked notes
		new NotePickerModal(this.app, (selectedFile) => {
			this.addAttachment(captureNote(selectedFile, 'primary'));
			this.composer.setAttachments(this.attachments);
		}).open();
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
		new ConversationPickerModal(this.app, conversations, (conversation) =>
			this.controller.openConversation(conversation.id),
		).open();
	}

	/** Export the current conversation as a Markdown note. */
	private exportConversation(conversation: Conversation): void {
		new PromptModal(this.app, {
			title: 'Export conversation',
			description: 'Choose export format and note name',
			placeholder: conversation.title || 'Conversation Export',
			submitText: 'Export',
			onSubmit: (name) => {
				const trimmed = name.trim();
				if (!trimmed) {
					new Notice('Please enter a note name.');
					return;
				}
				// Show format picker
				new Menu().addItem((item) =>
					item
						.setTitle('Full conversation (with questions)')
						.setIcon('file-text')
						.onClick(() => this.writeConversationNote(conversation, trimmed, 'full')),
				).addItem((item) =>
					item
						.setTitle('Answers only')
						.setIcon('list')
						.onClick(() => this.writeConversationNote(conversation, trimmed, 'answers')),
				).showAtMouseEvent({ clientX: 0, clientY: 0 } as MouseEvent);
			},
		}).open();
	}

	private writeConversationNote(
		conversation: Conversation,
		name: string,
		format: 'full' | 'answers',
	): void {
		const sanitized = name.replace(/[<>:"/\\|?*]/g, '-');
		const folder = this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
		let path = `${folder.path}/${sanitized}.md`;
		let counter = 1;
		let finalPath = path;
		while (this.app.vault.getAbstractFileByPath(finalPath)) {
			finalPath = `${folder.path}/${sanitized} ${counter}.md`;
			counter++;
		}

		const lines: string[] = [
			'---',
			`created: ${new Date().toISOString().split('T')[0]}`,
			'source: ObsAIde',
			'---',
			'',
			`# ${sanitized}`,
			'',
		];

		if (format === 'full') {
			for (const message of conversation.messages) {
				if (message.role === 'user') {
					const prefix = message.actionLabel ? `${message.actionLabel}: ` : '';
					lines.push(`## You`);
					lines.push('');
					lines.push(`${prefix}${message.text}`);
					lines.push('');
				} else if (message.role === 'assistant' && message.text.trim() && !message.error) {
					lines.push(`## ${ASSISTANT_NAME}`);
					lines.push('');
					lines.push(message.text);
					lines.push('');
				}
			}
		} else {
			// Answers only
			for (const message of conversation.messages) {
				if (message.role === 'assistant' && message.text.trim() && !message.error) {
					lines.push(message.text);
					lines.push('');
					lines.push('---');
					lines.push('');
				}
			}
		}

		const content = lines.join('\n');

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
					if (activeFile) this.addAttachment(captureNote(activeFile));
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Choose a note…')
				.setIcon('search')
				.onClick(() => {
					new NotePickerModal(this.app, (file) =>
						this.addAttachment(captureNote(file)),
					).open();
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

		this.providerButton.setText(label);
		setTooltip(this.providerButton, `Provider: ${label}. Select to change.`);
		this.providerButton.toggleClass('is-unconfigured', !configured);

		const model = this.controller.model || 'Choose a model';
		this.modelButton.setText(summarize(model, 28));
		setTooltip(this.modelButton, `Model: ${model}. Select to change.`);

		this.updateLengthButton();

		this.modeBadge.toggleClass('is-visible', this.controller.current.mode === 'tutor');
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
