import type { NoteEditAnchor } from '../actions/anchor';
import type { Attachment } from '../context/types';
import type { AideMode } from '../prompts/system';
import type { ChatMessage, ProviderId } from '../providers/types';
import { createId } from '../utils/id';
import { summarize } from '../utils/text';

export interface MessageError {
	kind: string;
	message: string;
	retryable: boolean;
}

export interface ConversationMessage {
	id: string;
	role: 'user' | 'assistant';
	/** What the UI shows. For user turns this is only what they typed. */
	text: string;
	/**
	 * For user turns, the full content that was sent, context included. Kept so
	 * follow-up turns stay consistent with what the model actually saw.
	 */
	sentText?: string;
	attachments?: Attachment[];
	/** Says so when context had to be trimmed to fit the budget. */
	contextNote?: string;
	createdAt: number;
	/** Present on assistant turns that failed. */
	error?: MessageError;
	/** The user pressed stop before the reply finished. */
	stopped?: boolean;
	providerId?: ProviderId;
	model?: string;
	/** Name of the note action that produced this exchange. */
	actionLabel?: string;
	/**
	 * Where this reply came from, and where it can be written back to.
	 *
	 * Captured when the request was made rather than resolved at apply time,
	 * because by then the sidebar and a modal have both taken focus.
	 */
	anchor?: NoteEditAnchor;
	/** The reply was generated to replace the anchored text. */
	replacesAnchor?: boolean;
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	mode: AideMode;
	messages: ConversationMessage[];
	/** Branch metadata. */
	parentConversationId?: string;
	branchedFromMessageId?: string;
	branchName?: string;
	/** Active profile ID for this conversation. */
	activeProfileId?: string;
}

export function createConversation(mode: AideMode): Conversation {
	const now = Date.now();
	return {
		id: createId('c-'),
		title: '',
		createdAt: now,
		updatedAt: now,
		mode,
		messages: [],
	};
}

export function createMessage(
	role: ConversationMessage['role'],
	text: string,
	extra: Partial<ConversationMessage> = {},
): ConversationMessage {
	return {
		id: createId('m-'),
		role,
		text,
		createdAt: Date.now(),
		...extra,
	};
}

/** Title shown in the history list; derived from the first thing the user said. */
export function conversationTitle(conversation: Conversation): string {
	if (conversation.title) return conversation.title;
	const first = conversation.messages.find((message) => message.role === 'user');
	if (!first) return 'New conversation';
	const label = first.actionLabel ? `${first.actionLabel}: ` : '';
	return `${label}${summarize(first.text, 48)}` || 'New conversation';
}

/**
 * Project a conversation onto the provider message list.
 *
 * Failed turns are dropped so a retry does not resend a broken exchange, and
 * user turns carry the context that was attached at the time.
 */
export function toProviderMessages(conversation: Conversation): ChatMessage[] {
	const messages: ChatMessage[] = [];
	for (const message of conversation.messages) {
		if (message.role === 'user') {
			const content = message.sentText ?? message.text;
			if (content.trim()) messages.push({ role: 'user', content });
			continue;
		}
		if (message.error || !message.text.trim()) continue;
		messages.push({ role: 'assistant', content: message.text });
	}
	return messages;
}

/** Number of user turns, used for the empty-state check. */
export function isEmptyConversation(conversation: Conversation): boolean {
	return conversation.messages.length === 0;
}

/**
 * Create a new conversation branched from an existing one at a specific message.
 *
 * The new conversation copies history up to and including the specified message.
 */
export function createBranch(
	parent: Conversation,
	branchedFromMessageId: string,
): Conversation {
	const messageIndex = parent.messages.findIndex(m => m.id === branchedFromMessageId);
	if (messageIndex === -1) {
		throw new Error(`Message ${branchedFromMessageId} not found in parent conversation`);
	}

	const branch = createConversation(parent.mode);
	branch.messages = parent.messages.slice(0, messageIndex + 1).map(msg => ({ ...msg }));
	branch.parentConversationId = parent.id;
	branch.branchedFromMessageId = branchedFromMessageId;
	// Use a clean branch indicator that doesn't compound when branching a branch
	const rootTitle = getRootConversationTitle(parent);
	branch.branchName = `${rootTitle} · Branch`;
	branch.title = branch.branchName;

	return branch;
}

/**
 * Get the root conversation title, stripping any existing branch indicators.
 * This prevents "Title — Branch — Branch — Branch" when branching a branch.
 */
export function getRootConversationTitle(conversation: Conversation): string {
	const title = conversationTitle(conversation);
	// Strip existing branch suffixes (both old " — Branch" and new " · Branch" formats)
	return title
		.replace(/\s*—\s*Branch\s*$/, '')
		.replace(/\s*·\s*Branch\s*$/, '')
		.trim();
}

/** Migration: clean up existing conversation titles that have compounded branch suffixes. */
export function migrateBranchTitles(conversations: Conversation[]): number {
	let migrated = 0;
	for (const conversation of conversations) {
		const originalTitle = conversation.title;
		const cleanedTitle = getRootConversationTitle(conversation);
		if (originalTitle !== cleanedTitle) {
			conversation.title = cleanedTitle;
			migrated++;
		}
	}
	return migrated;
}
