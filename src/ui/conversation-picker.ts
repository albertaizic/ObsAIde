import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian';
import { conversationTitle, type Conversation } from '../chat/conversation';

/** Reopen an earlier conversation from local history. */
export class ConversationPickerModal extends FuzzySuggestModal<Conversation> {
	constructor(
		app: App,
		private readonly conversations: Conversation[],
		private readonly onChoose: (conversation: Conversation) => void,
	) {
		super(app);
		this.setPlaceholder('Open a recent conversation…');
	}

	getItems(): Conversation[] {
		return this.conversations;
	}

	getItemText(conversation: Conversation): string {
		return conversationTitle(conversation);
	}

	override renderSuggestion(match: FuzzyMatch<Conversation>, el: HTMLElement): void {
		const conversation = match.item;
		el.addClass('obsaide-model-suggestion');

		const titleRow = el.createDiv({ cls: 'obsaide-model-title-row' });
		titleRow.createDiv({
			cls: 'obsaide-model-title',
			text: conversationTitle(conversation),
		});

		// Show branch indicator
		if (conversation.parentConversationId) {
			const branchBadge = titleRow.createSpan({ cls: 'obsaide-branch-badge' });
			branchBadge.setText('↳ branch');
		}

		const turns = conversation.messages.filter((m) => m.role === 'user').length;
		el.createDiv({
			cls: 'obsaide-model-meta',
			text: `${turns} ${turns === 1 ? 'message' : 'messages'} · ${formatWhen(conversation.updatedAt)}`,
		});
	}

	onChooseItem(conversation: Conversation): void {
		this.onChoose(conversation);
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
