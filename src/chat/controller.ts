import type { App } from 'obsidian';
import { buildContextBlock } from '../context/resolve';
import type { Attachment } from '../context/types';
import { buildSystemPrompt, type AideMode } from '../prompts/system';
import { AideError, toAideError } from '../providers/errors';
import type { ProviderService } from '../providers/service';
import type { ProviderId } from '../providers/types';
import { collectSecrets, type ObsAideSettings } from '../settings/types';
import { composeUserContent } from '../context/format';
import {
	createMessage,
	toProviderMessages,
	type Conversation,
	type ConversationMessage,
	type EditProposalTarget,
} from './conversation';
import type { ConversationStore } from './store';

export type ChatChangeReason = 'structure' | 'stream';

export interface SendRequest {
	/** Shown as the user's message in the transcript. */
	displayText: string;
	/** Instruction actually sent; defaults to `displayText`. */
	prompt?: string;
	attachments?: Attachment[];
	/** Name of the note action behind this turn, e.g. "Improve writing". */
	actionLabel?: string;
	/** Extra system instructions contributed by that action. */
	actionInstructions?: string;
	/** Makes the resulting reply applicable back to a note. */
	proposalTarget?: EditProposalTarget;
}

export interface ChatControllerDeps {
	app: App;
	providers: ProviderService;
	store: ConversationStore;
	getSettings: () => ObsAideSettings;
	saveSettings: () => Promise<void>;
}

/**
 * Owns conversation state and every provider call the chat makes.
 *
 * The view renders whatever the controller exposes and never talks to a
 * provider itself, which keeps request handling in one testable place.
 */
export class ChatController {
	private conversation: Conversation;
	private listeners = new Set<(reason: ChatChangeReason) => void>();
	private abortController: AbortController | null = null;
	private generatingMessageId: string | null = null;
	/** Remembers the last turn so it can be regenerated. */
	private lastActionInstructions: string | undefined;

	constructor(private readonly deps: ChatControllerDeps) {
		this.conversation = deps.store.mostRecent(
			deps.getSettings().tutorModeByDefault ? 'tutor' : 'chat',
		);
	}

	get current(): Conversation {
		return this.conversation;
	}

	get isGenerating(): boolean {
		return this.generatingMessageId !== null;
	}

	/** The reply currently being written, if any. */
	get generatingMessage(): ConversationMessage | null {
		if (!this.generatingMessageId) return null;
		return (
			this.conversation.messages.find(
				(message) => message.id === this.generatingMessageId,
			) ?? null
		);
	}

	get providerId(): ProviderId {
		return this.deps.getSettings().defaultProvider;
	}

	get model(): string {
		const settings = this.deps.getSettings();
		return settings.providers[settings.defaultProvider].model;
	}

	onChange(listener: (reason: ChatChangeReason) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(reason: ChatChangeReason): void {
		for (const listener of this.listeners) listener(reason);
	}

	// --- conversation management -------------------------------------------

	newConversation(): void {
		this.stop();
		const settings = this.deps.getSettings();
		const mode = settings.tutorModeByDefault ? 'tutor' : 'chat';
		// Starting over in an already-empty conversation would just litter the
		// history with identical blank entries.
		if (this.conversation.messages.length === 0) {
			this.conversation.mode = mode;
			this.emit('structure');
			return;
		}
		this.conversation = this.deps.store.create(mode);
		this.emit('structure');
	}

	openConversation(id: string): void {
		const conversation = this.deps.store.get(id);
		if (!conversation) return;
		this.stop();
		this.conversation = conversation;
		this.emit('structure');
	}

	clearConversation(): void {
		this.stop();
		this.conversation.messages = [];
		this.conversation.title = '';
		this.deps.store.touch(this.conversation);
		this.emit('structure');
	}

	deleteConversation(id: string): void {
		this.deps.store.remove(id);
		if (this.conversation.id === id) this.newConversation();
		else this.emit('structure');
	}

	setMode(mode: AideMode): void {
		this.conversation.mode = mode;
		this.deps.store.touch(this.conversation);
		this.emit('structure');
	}

	async setProvider(providerId: ProviderId): Promise<void> {
		const settings = this.deps.getSettings();
		settings.defaultProvider = providerId;
		await this.deps.saveSettings();
		this.emit('structure');
	}

	async setModel(model: string): Promise<void> {
		const settings = this.deps.getSettings();
		settings.providers[settings.defaultProvider].model = model;
		await this.deps.saveSettings();
		this.emit('structure');
	}

	// --- generation ---------------------------------------------------------

	stop(): void {
		this.abortController?.abort();
	}

	async send(request: SendRequest): Promise<void> {
		if (this.isGenerating) return;

		const settings = this.deps.getSettings();
		const attachments = request.attachments ?? [];
		let sentText = request.prompt ?? request.displayText;

		if (attachments.length > 0) {
			const { block } = await buildContextBlock(this.deps.app, attachments, {
				maxCharsPerNote: settings.maxCharsPerNote,
				maxContextChars: settings.maxContextChars,
			});
			sentText = composeUserContent(block, sentText);
		}

		const userMessage = createMessage('user', request.displayText, {
			sentText,
			attachments: attachments.length > 0 ? attachments : undefined,
			actionLabel: request.actionLabel,
		});
		this.conversation.messages.push(userMessage);
		this.lastActionInstructions = request.actionInstructions;
		this.emit('structure');

		await this.runTurn({
			actionLabel: request.actionLabel,
			actionInstructions: request.actionInstructions,
			proposal: request.proposalTarget,
		});
	}

	/** Drop the last reply and ask again with the same conversation. */
	async regenerate(): Promise<void> {
		if (this.isGenerating) return;
		const messages = this.conversation.messages;
		const lastIndex = messages.map((message) => message.role).lastIndexOf('assistant');
		if (lastIndex === -1) return;
		const previous = messages[lastIndex];
		messages.splice(lastIndex, 1);
		this.emit('structure');
		await this.runTurn({
			actionLabel: previous?.actionLabel,
			actionInstructions: this.lastActionInstructions,
			proposal: previous?.proposal,
		});
	}

	private async runTurn(extra: {
		actionLabel?: string;
		actionInstructions?: string;
		proposal?: EditProposalTarget;
	}): Promise<void> {
		const settings = this.deps.getSettings();
		const providerId = settings.defaultProvider;
		const model = settings.providers[providerId].model;

		// Snapshot the history before the placeholder reply joins the list.
		const history = toProviderMessages(this.conversation);

		const assistant = createMessage('assistant', '', {
			providerId,
			model,
			actionLabel: extra.actionLabel,
			proposal: extra.proposal,
		});
		this.conversation.messages.push(assistant);
		this.generatingMessageId = assistant.id;
		const controller = new AbortController();
		this.abortController = controller;
		this.emit('structure');

		const systemPrompt = buildSystemPrompt({
			mode: this.conversation.mode,
			customInstructions: settings.customInstructions,
			actionInstructions: extra.actionInstructions,
		});

		try {
			const result = await this.deps.providers.complete({
				providerId,
				model,
				system: systemPrompt,
				messages: history,
				signal: controller.signal,
				onText: (delta) => {
					assistant.text += delta;
					this.emit('stream');
				},
			});
			// The buffered path emits the whole reply through `onText`; trust the
			// result text only when nothing streamed.
			if (!assistant.text) assistant.text = result.text;
			if (result.model) assistant.model = result.model;
			assistant.stopped = controller.signal.aborted;
		} catch (error) {
			this.applyFailure(assistant, error, settings);
		} finally {
			this.generatingMessageId = null;
			this.abortController = null;
			this.deps.store.touch(this.conversation);
			this.emit('structure');
		}
	}

	private applyFailure(
		assistant: ConversationMessage,
		error: unknown,
		settings: ObsAideSettings,
	): void {
		const aideError =
			error instanceof AideError ? error : toAideError(error, collectSecrets(settings));

		if (aideError.kind === 'aborted') {
			assistant.stopped = true;
			// A stop with nothing generated leaves no useful message behind.
			if (!assistant.text.trim()) {
				this.conversation.messages = this.conversation.messages.filter(
					(message) => message.id !== assistant.id,
				);
			}
			return;
		}

		assistant.error = {
			kind: aideError.kind,
			message: aideError.message,
			retryable: aideError.retryable,
		};
	}
}
