import { setIcon, setTooltip, type App, type Component } from 'obsidian';
import { ASSISTANT_NAME } from '../constants';
import type { Conversation, ConversationMessage } from '../chat/conversation';
import type { Attachment } from '../context/types';
import { attachmentIcon, attachmentLabel } from './attachment-chip';
import { MarkdownBlock, copyToClipboard } from './markdown';

export interface MessageListCallbacks {
	onRegenerate: () => void;
	onOpenSettings: () => void;
	/** Opens the review-before-apply modal. */
	onUseInNote: (message: ConversationMessage) => void;
	/** Writes straight to the caret the request was made from. */
	onInsertAtCursor: (message: ConversationMessage) => void;
	/** Whether this reply can currently be written to a note. */
	canInsert: (message: ConversationMessage) => boolean;
	/** Shows which notes an attached folder contributed. */
	onInspectAttachment: (attachment: Attachment) => void;
}

interface RenderedMessage {
	el: HTMLElement;
	bodyEl: HTMLElement;
	block: MarkdownBlock | null;
}

/** Renders the transcript and keeps streaming updates cheap. */
export class MessageList {
	private rendered = new Map<string, RenderedMessage>();

	constructor(
		private readonly app: App,
		private readonly container: HTMLElement,
		private readonly parent: Component,
		private readonly callbacks: MessageListCallbacks,
	) {}

	/**
	 * Rebuild the transcript.
	 *
	 * Resolves once every Markdown block has rendered, so the caller can scroll
	 * to the bottom against the final layout rather than the empty one.
	 */
	async render(conversation: Conversation, generatingId: string | null): Promise<void> {
		this.teardown();
		this.container.empty();

		const lastAssistantId = [...conversation.messages]
			.reverse()
			.find((message) => message.role === 'assistant')?.id;

		const pending: Promise<void>[] = [];
		for (const message of conversation.messages) {
			const work = this.renderMessage(message, {
				isGenerating: message.id === generatingId,
				isLastAssistant: message.id === lastAssistantId,
			});
			if (work) pending.push(work);
		}
		await Promise.all(pending);
	}

	/** Update only the reply currently streaming. */
	updateStreaming(message: ConversationMessage): Promise<void> {
		const entry = this.rendered.get(message.id);
		if (!entry?.block) return Promise.resolve();
		entry.el.removeClass('is-waiting');
		return entry.block.render(message.text);
	}

	destroy(): void {
		this.teardown();
	}

	private teardown(): void {
		for (const entry of this.rendered.values()) entry.block?.destroy();
		this.rendered.clear();
	}

	private renderMessage(
		message: ConversationMessage,
		state: { isGenerating: boolean; isLastAssistant: boolean },
	): Promise<void> | null {
		const isUser = message.role === 'user';
		const el = this.container.createDiv({
			cls: `obsaide-message ${isUser ? 'is-user' : 'is-assistant'}`,
		});

		const head = el.createDiv({ cls: 'obsaide-message-head' });
		head.createSpan({
			cls: 'obsaide-message-role',
			text: isUser ? 'You' : ASSISTANT_NAME,
		});
		if (message.actionLabel) {
			head.createSpan({ cls: 'obsaide-message-tag', text: message.actionLabel });
		}
		if (!isUser && message.model) {
			const meta = head.createSpan({ cls: 'obsaide-message-model', text: message.model });
			setTooltip(meta, `Generated with ${message.model}`);
		}

		if (message.attachments?.length) {
			this.renderAttachments(el, message.attachments);
		}
		if (message.contextNote) {
			el.createDiv({ cls: 'obsaide-message-note', text: message.contextNote });
		}

		const bodyEl = el.createDiv({ cls: 'obsaide-message-body' });
		let block: MarkdownBlock | null = null;
		let work: Promise<void> | null = null;

		if (isUser) {
			// User text is shown verbatim: it is theirs, not Markdown we produced.
			bodyEl.addClass('obsaide-user-text');
			bodyEl.setText(message.text);
		} else if (message.text) {
			block = new MarkdownBlock(this.app, bodyEl, this.parent, '');
			work = block.render(message.text);
		} else if (state.isGenerating) {
			el.addClass('is-waiting');
			const waiting = bodyEl.createDiv({ cls: 'obsaide-waiting' });
			waiting.createSpan({ cls: 'obsaide-dot' });
			waiting.createSpan({ cls: 'obsaide-dot' });
			waiting.createSpan({ cls: 'obsaide-dot' });
			// The block replaces the dots as soon as the first token lands.
			block = new MarkdownBlock(this.app, bodyEl, this.parent, '');
		}

		if (message.stopped && message.text) {
			el.createDiv({ cls: 'obsaide-message-note', text: 'Stopped by you.' });
		}

		if (message.error) this.renderError(el, message.error);
		if (!isUser && !state.isGenerating) {
			this.renderActions(el, message, state.isLastAssistant);
		}

		this.rendered.set(message.id, { el, bodyEl, block });
		return work;
	}

	private renderAttachments(parent: HTMLElement, attachments: Attachment[]): void {
		const row = parent.createDiv({ cls: 'obsaide-chips is-readonly' });
		for (const attachment of attachments) {
			const chip = row.createDiv({ cls: 'obsaide-chip' });
			const icon = chip.createSpan({ cls: 'obsaide-chip-icon' });
			setIcon(icon, attachmentIcon(attachment.kind));
			chip.createSpan({
				cls: 'obsaide-chip-label',
				text: attachmentLabel(attachment),
			});
			if (attachment.role === 'supporting') {
				chip.createSpan({ cls: 'obsaide-chip-role', text: 'context' });
			}
			setTooltip(chip, attachment.path ?? attachment.title);

			if (attachment.kind === 'folder') {
				chip.addClass('is-clickable');
				chip.addEventListener('click', () =>
					this.callbacks.onInspectAttachment(attachment),
				);
			}
		}
	}

	private renderError(
		parent: HTMLElement,
		error: NonNullable<ConversationMessage['error']>,
	): void {
		const box = parent.createDiv({ cls: 'obsaide-error' });
		const icon = box.createSpan({ cls: 'obsaide-error-icon' });
		setIcon(icon, 'alert-triangle');
		box.createSpan({ cls: 'obsaide-error-text', text: error.message });

		const actions = box.createDiv({ cls: 'obsaide-error-actions' });
		if (error.retryable) {
			const retry = actions.createEl('button', {
				cls: 'obsaide-button is-small',
				text: 'Retry',
			});
			retry.addEventListener('click', () => this.callbacks.onRegenerate());
		}
		if (
			error.kind === 'missing-api-key' ||
			error.kind === 'not-configured' ||
			error.kind === 'authentication' ||
			error.kind === 'invalid-model'
		) {
			const settings = actions.createEl('button', {
				cls: 'obsaide-button is-small',
				text: 'Open settings',
			});
			settings.addEventListener('click', () => this.callbacks.onOpenSettings());
		}
	}

	private renderActions(
		parent: HTMLElement,
		message: ConversationMessage,
		isLastAssistant: boolean,
	): void {
		if (!message.text.trim()) return;

		// A reply generated to replace note content gets a real button: applying
		// it is the expected next step, but it still opens a review first.
		if (message.replacesAnchor) {
			const review = parent.createDiv({ cls: 'obsaide-proposal' });
			const button = review.createEl('button', {
				cls: 'obsaide-button is-small',
				text: 'Review change…',
			});
			button.addEventListener('click', () => this.callbacks.onUseInNote(message));
		}

		const actions = parent.createDiv({ cls: 'obsaide-message-actions' });

		this.iconButton(actions, 'copy', 'Copy reply', () => {
			void copyToClipboard(message.text, 'Reply copied');
		});

		// Insertion is offered only when the originating note is still open, so
		// a reply can never land in an unrelated file.
		if (this.callbacks.canInsert(message)) {
			this.iconButton(actions, 'arrow-down-to-line', 'Insert at cursor', () => {
				this.callbacks.onInsertAtCursor(message);
			});
			this.iconButton(actions, 'file-input', 'Use in note…', () => {
				this.callbacks.onUseInNote(message);
			});
		}

		if (isLastAssistant) {
			this.iconButton(actions, 'refresh-cw', 'Regenerate', () =>
				this.callbacks.onRegenerate(),
			);
		}
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const button = parent.createEl('button', { cls: 'obsaide-icon-button is-small' });
		setIcon(button, icon);
		setTooltip(button, label);
		button.setAttribute('aria-label', label);
		button.addEventListener('click', onClick);
	}
}
