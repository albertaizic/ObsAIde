import type { Attachment } from '../context/types';
import type { AideMode } from '../prompts/system';
import type { ChatMessage, ProviderId } from '../providers/types';
import { createId } from '../utils/id';
import { summarize } from '../utils/text';

/**
 * Where an assistant reply proposes replacing note content.
 *
 * The original text is kept so the edit can be verified before it is applied:
 * if the note moved on in the meantime, ObsAIde refuses to overwrite it.
 */
export interface EditProposalTarget {
	path: string;
	originalText: string;
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	/** Whether the range was a selection or the whole document. */
	scope: 'selection' | 'document';
}

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
	createdAt: number;
	/** Present on assistant turns that failed. */
	error?: MessageError;
	/** The user pressed stop before the reply finished. */
	stopped?: boolean;
	providerId?: ProviderId;
	model?: string;
	/** Name of the note action that produced this exchange. */
	actionLabel?: string;
	/** Set when this reply can be applied back to a note. */
	proposal?: EditProposalTarget;
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	mode: AideMode;
	messages: ConversationMessage[];
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
