import { Menu, Modal, type App, setIcon } from 'obsidian';
import { conversationTitle, getRootConversationTitle, type Conversation } from '../chat/conversation';
import { ConversationStore } from '../chat/store';

/** Options for the conversation picker modal. */
export interface ConversationPickerOptions {
	store: ConversationStore;
	onChoose: (conversation: Conversation) => void;
	onDelete?: (id: string) => void;
	onRename?: (id: string, newTitle: string) => void;
	onBranch?: (id: string) => void;
	currentConversationId?: string;
}

/** Modal for browsing and managing conversation history. */
export class ConversationPickerModal extends Modal {
	private readonly store: ConversationStore;
	private readonly onChoose: (conversation: Conversation) => void;
	private readonly onDelete: ((id: string) => void) | undefined;
	private readonly onRename: ((id: string, newTitle: string) => void) | undefined;
	private readonly onBranch: ((id: string) => void) | undefined;
	private readonly currentConversationId: string | undefined;
	private filter = '';
	private unsubscribe: (() => void) | null = null;

	constructor(app: App, options: ConversationPickerOptions) {
		super(app);
		this.store = options.store;
		this.onChoose = options.onChoose;
		this.onDelete = options.onDelete;
		this.onRename = options.onRename;
		this.onBranch = options.onBranch;
		this.currentConversationId = options.currentConversationId;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-conversation-picker-modal');

		// Subscribe to store changes for live updates
		this.unsubscribe = this.store.subscribe(() => this.renderList());

		// Header with search and new conversation
		const header = contentEl.createDiv({ cls: 'obsaide-conversation-picker-header' });

		const headerRow = header.createDiv({ cls: 'obsaide-picker-header-row' });
		headerRow.createEl('h3', { text: 'Recent conversations' });

		const newChatBtn = headerRow.createEl('button', {
			cls: 'obsaide-new-conversation-btn',
			attr: { 'aria-label': 'New conversation' },
		});
		newChatBtn.createSpan({ cls: 'obsaide-new-conversation-icon' });
		setIcon(newChatBtn.querySelector('.obsaide-new-conversation-icon')!, 'plus');
		newChatBtn.createSpan({ cls: 'obsaide-new-conversation-label', text: 'New conversation' });
		newChatBtn.addEventListener('click', () => {
			this.close();
			this.onChoose({} as Conversation);
		});

		const searchContainer = header.createDiv({ cls: 'obsaide-conversation-search' });
		const searchIcon = searchContainer.createSpan({ cls: 'obsaide-search-icon' });
		setIcon(searchIcon, 'search');
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			cls: 'obsaide-conversation-search-input',
			attr: { placeholder: 'Filter conversations…' },
		});
		searchInput.addEventListener('input', () => {
			this.filter = searchInput.value.trim().toLowerCase();
			this.renderList();
		});
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') this.close();
		});
		searchInput.focus();

		// List container
		this.listContainer = contentEl.createDiv({ cls: 'obsaide-conversation-list' });

		this.renderList();
	}

	private listContainer!: HTMLElement;

	private renderList(): void {
		this.listContainer.empty();

		const conversations = this.store.list().filter((conv) => {
			if (!this.filter) return true;
			const title = conversationTitle(conv).toLowerCase();
			return title.includes(this.filter);
		});

		if (conversations.length === 0) {
			this.listContainer.createDiv({
				cls: 'obsaide-conversation-empty',
				text: this.filter ? 'No conversations match your filter' : 'No conversations yet.',
			});
			return;
		}

		for (const conversation of conversations) {
			this.renderConversationItem(conversation);
		}
	}

	private renderConversationItem(conversation: Conversation): void {
		const item = this.listContainer.createDiv({ cls: 'obsaide-conversation-item' });
		item.dataset.id = conversation.id;

		const isCurrent = conversation.id === this.currentConversationId;

		// Main content (clickable to open)
		const main = item.createDiv({ cls: 'obsaide-conversation-main' });

		const titleRow = main.createDiv({ cls: 'obsaide-conversation-title-row' });

		// Conversation title - use root title (without branch suffix)
		const rootTitle = getRootConversationTitle(conversation);
		titleRow.createDiv({
			cls: 'obsaide-conversation-title',
			text: rootTitle,
		});

		// Show current conversation indicator (subtle)
		if (isCurrent) {
			const currentBadge = titleRow.createSpan({ cls: 'obsaide-current-badge' });
			currentBadge.setText('Current');
		}

		// Metadata - include branch indicator here
		const turns = conversation.messages.filter((m) => m.role === 'user').length;
		let metaText = `${turns} ${turns === 1 ? 'message' : 'messages'} · ${formatWhen(conversation.updatedAt)}`;
		if (conversation.parentConversationId) {
			metaText = `↳ Branch · ${metaText}`;
		}
		main.createDiv({
			cls: 'obsaide-conversation-meta',
			text: metaText,
		});

		// Click to open
		main.addEventListener('click', () => {
			this.onChoose(conversation);
			this.close();
		});

		// Overflow menu button (⋯) - shows on hover
		const actions = item.createDiv({ cls: 'obsaide-conversation-actions' });
		const menuBtn = actions.createEl('button', {
			cls: 'obsaide-conversation-menu',
			attr: { 'aria-label': 'More options' },
		});
		setIcon(menuBtn, 'more-horizontal');
		menuBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showItemMenu(menuBtn, conversation);
		});

		// Keyboard support
		item.setAttribute('tabindex', '0');
		item.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.onChoose(conversation);
				this.close();
			} else if (e.key === 'Delete' || e.key === 'Backspace') {
				e.preventDefault();
				this.confirmDelete(conversation);
			}
		});

		// Apply current conversation styling (subtle left border)
		if (isCurrent) {
			item.addClass('is-current');
		}
	}

	private showItemMenu(button: HTMLButtonElement, conversation: Conversation): void {
		const menu = new Menu();

		// Rename
		if (this.onRename) {
			menu.addItem((item) =>
				item
					.setTitle('Rename')
					.setIcon('pencil')
					.onClick(() => this.promptRename(conversation)),
			);
		}

		// Branch (only for non-branch conversations or branches that can be branched further)
		if (this.onBranch && !isEmptyConversation(conversation)) {
			menu.addItem((item) =>
				item
					.setTitle('Branch from here')
					.setIcon('git-branch')
					.onClick(() => this.onBranch!(conversation.id)),
			);
		}

		menu.addSeparator();

		// Delete
		if (this.onDelete) {
			menu.addItem((item) =>
				item
					.setTitle('Delete')
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(() => this.confirmDelete(conversation)),
			);
		}

		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private promptRename(conversation: Conversation): void {
		const currentTitle = conversation.branchName || conversationTitle(conversation);
		new RenameModal(this.app, currentTitle, (newTitle) => {
			if (this.onRename) this.onRename(conversation.id, newTitle);
			this.renderList();
		}).open();
	}

	private confirmDelete(conversation: Conversation): void {
		if (!this.onDelete) return;

		const modal = new ConfirmDeleteModal(this.app, conversationTitle(conversation), () => {
			this.onDelete!(conversation.id);
			this.renderList();
		});
		modal.open();
	}

	override onClose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.contentEl.empty();
	}
}

/** Modal for renaming a conversation. */
class RenameModal extends Modal {
	constructor(
		app: App,
		private readonly currentTitle: string,
		private readonly onConfirm: (newTitle: string) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-rename-modal');

		contentEl.createEl('h3', { text: 'Rename conversation' });

		const input = contentEl.createEl('input', {
			type: 'text',
			cls: 'obsaide-rename-input',
			value: this.currentTitle,
		});
		input.focus();
		input.select();

		const submit = () => {
			const newTitle = input.value.trim();
			if (newTitle && newTitle !== this.currentTitle) {
				this.onConfirm(newTitle);
			}
			this.close();
		};

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') submit();
			else if (e.key === 'Escape') this.close();
		});

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => this.close());

		buttons.createEl('button', {
			cls: 'obsaide-button is-cta',
			text: 'Rename',
		}).addEventListener('click', submit);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Confirmation modal for deleting a conversation. */
class ConfirmDeleteModal extends Modal {
	constructor(
		app: App,
		private readonly conversationTitle: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-confirm-delete-modal');

		contentEl.createEl('h3', { text: 'Delete conversation?' });

		contentEl.createEl('p', {
			cls: 'obsaide-modal-description',
			text: `"${this.conversationTitle}"`,
		});

		contentEl.createEl('p', {
			cls: 'obsaide-modal-description',
			text: 'This cannot be undone.',
		});

		const buttons = contentEl.createDiv({ cls: 'obsaide-modal-footer is-actions' });
		buttons.createEl('button', {
			cls: 'obsaide-button',
			text: 'Cancel',
		}).addEventListener('click', () => this.close());

		buttons.createEl('button', {
			cls: 'obsaide-button is-danger',
			text: 'Delete',
		}).addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Check if a conversation is empty (no messages). */
function isEmptyConversation(conversation: Conversation): boolean {
	return conversation.messages.length === 0;
}

function formatWhen(timestamp: number): string {
	const minutes = Math.round((Date.now() - timestamp) / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(timestamp).toLocaleDateString();
}