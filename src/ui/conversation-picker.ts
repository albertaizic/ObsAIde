import { Modal, type App, setIcon } from 'obsidian';
import { conversationTitle, type Conversation } from '../chat/conversation';

/** Options for the conversation picker modal. */
export interface ConversationPickerOptions {
	conversations: Conversation[];
	onChoose: (conversation: Conversation) => void;
	onDelete?: (id: string) => void;
	currentConversationId?: string;
}

/** Modal for browsing and managing conversation history. */
export class ConversationPickerModal extends Modal {
	private readonly conversations: Conversation[];
	private readonly onChoose: (conversation: Conversation) => void;
	private readonly onDelete: ((id: string) => void) | undefined;
	private readonly currentConversationId: string | undefined;
	private filter = '';
	private filteredConversations: Conversation[] = [];

	constructor(app: App, options: ConversationPickerOptions) {
		super(app);
		this.conversations = options.conversations;
		this.onChoose = options.onChoose;
		this.onDelete = options.onDelete;
		this.currentConversationId = options.currentConversationId;
		this.filteredConversations = this.conversations;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('obsaide-conversation-picker-modal');

		// Header with search
		const header = contentEl.createDiv({ cls: 'obsaide-conversation-picker-header' });
		header.createEl('h3', { text: 'Recent conversations' });

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

		this.filteredConversations = this.conversations.filter((conv) => {
			if (!this.filter) return true;
			const title = conversationTitle(conv).toLowerCase();
			return title.includes(this.filter);
		});

		if (this.filteredConversations.length === 0) {
			this.listContainer.createDiv({
				cls: 'obsaide-conversation-empty',
				text: this.filter ? 'No conversations match your filter' : 'No conversations yet.',
			});
			return;
		}

		for (const conversation of this.filteredConversations) {
			this.renderConversationItem(conversation);
		}
	}

	private renderConversationItem(conversation: Conversation): void {
		const item = this.listContainer.createDiv({ cls: 'obsaide-conversation-item' });
		item.dataset.id = conversation.id;

		// Main content (clickable to open)
		const main = item.createDiv({ cls: 'obsaide-conversation-main' });

		const titleRow = main.createDiv({ cls: 'obsaide-conversation-title-row' });
		titleRow.createDiv({
			cls: 'obsaide-conversation-title',
			text: conversationTitle(conversation),
		});

		// Show branch indicator
		if (conversation.parentConversationId) {
			const branchBadge = titleRow.createSpan({ cls: 'obsaide-branch-badge' });
			branchBadge.setText('↳ branch');
		}

		// Show current conversation indicator
		if (conversation.id === this.currentConversationId) {
			const currentBadge = titleRow.createSpan({ cls: 'obsaide-current-badge' });
			currentBadge.setText('Current');
		}

		const turns = conversation.messages.filter((m) => m.role === 'user').length;
		main.createDiv({
			cls: 'obsaide-conversation-meta',
			text: `${turns} ${turns === 1 ? 'message' : 'messages'} · ${formatWhen(conversation.updatedAt)}`,
		});

		// Click to open
		main.addEventListener('click', () => {
			this.onChoose(conversation);
			this.close();
		});

		// Delete button (show on hover or always for touch)
		const actions = item.createDiv({ cls: 'obsaide-conversation-actions' });
		const deleteBtn = actions.createEl('button', {
			cls: 'obsaide-conversation-delete',
			attr: { 'aria-label': 'Delete conversation' },
		});
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.confirmDelete(conversation);
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

function formatWhen(timestamp: number): string {
	const minutes = Math.round((Date.now() - timestamp) / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(timestamp).toLocaleDateString();
}