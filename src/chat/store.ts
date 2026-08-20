import type { AideMode } from '../prompts/system';
import { createConversation, type Conversation, type ConversationMessage, migrateBranchTitles } from './conversation';

/**
 * Persistence is deliberately behind a tiny interface: the store itself is
 * plain data handling and can be exercised without Obsidian.
 */
export interface ConversationStorage {
	read(): Promise<unknown>;
	write(data: unknown): Promise<void>;
	remove(): Promise<void>;
}

export interface ConversationStoreOptions {
	/** Oldest conversations beyond this count are dropped. */
	limit?: number;
	/** Debounce for writes, so streaming does not hit disk on every token. */
	saveDelayMs?: number;
	/** When false, nothing is written and any existing file is deleted. */
	isPersistenceEnabled: () => boolean;
}

const FILE_VERSION = 1;
const DEFAULT_LIMIT = 40;
const DEFAULT_SAVE_DELAY = 1500;

interface StoredFile {
	version: number;
	conversations: Conversation[];
}

function isMessage(value: unknown): value is ConversationMessage {
	if (typeof value !== 'object' || value === null) return false;
	const message = value as Record<string, unknown>;
	return (
		typeof message['id'] === 'string' &&
		(message['role'] === 'user' || message['role'] === 'assistant') &&
		typeof message['text'] === 'string'
	);
}

function isConversation(value: unknown): value is Conversation {
	if (typeof value !== 'object' || value === null) return false;
	const conversation = value as Record<string, unknown>;
	return (
		typeof conversation['id'] === 'string' &&
		Array.isArray(conversation['messages']) &&
		conversation['messages'].every(isMessage)
	);
}

type StoreListener = () => void;

/** Local, in-memory conversation history with debounced persistence. */
export class ConversationStore {
	private conversations: Conversation[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly limit: number;
	private readonly saveDelayMs: number;
	private listeners = new Set<StoreListener>();

	constructor(
		private readonly storage: ConversationStorage,
		private readonly options: ConversationStoreOptions,
	) {
		this.limit = options.limit ?? DEFAULT_LIMIT;
		this.saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY;
	}

	/** Subscribe to store changes. Returns an unsubscribe function. */
	subscribe(listener: StoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	async load(): Promise<void> {
		if (!this.options.isPersistenceEnabled()) {
			this.conversations = [];
			return;
		}
		let raw: unknown;
		try {
			raw = await this.storage.read();
		} catch {
			// A missing or unreadable history file is not worth an error: start
			// fresh rather than blocking the plugin from loading.
			this.conversations = [];
			return;
		}
		const file = raw as Partial<StoredFile> | undefined;
		const list = Array.isArray(file?.conversations) ? file.conversations : [];
		this.conversations = list.filter(isConversation).slice(0, this.limit);
		// Migration: clean up compounded branch titles
		if (this.conversations.length > 0) {
			migrateBranchTitles(this.conversations);
		}
	}

	list(): Conversation[] {
		return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	get(id: string): Conversation | undefined {
		return this.conversations.find((conversation) => conversation.id === id);
	}

	/** Most recent conversation, or a fresh one when there is no history. */
	mostRecent(mode: AideMode): Conversation {
		const [latest] = this.list();
		if (latest) return latest;
		return this.create(mode);
	}

	create(mode: AideMode): Conversation {
		const conversation = createConversation(mode);
		this.conversations.unshift(conversation);
		this.trim();
		this.scheduleSave();
		this.emit();
		return conversation;
	}

	remove(id: string): void {
		this.conversations = this.conversations.filter(
			(conversation) => conversation.id !== id,
		);
		this.scheduleSave();
		this.emit();
	}

	clear(): void {
		this.conversations = [];
		this.scheduleSave();
		this.emit();
	}

	/** Record that a conversation changed and schedule a write. */
	touch(conversation: Conversation): void {
		conversation.updatedAt = Date.now();
		if (!this.conversations.includes(conversation)) {
			this.conversations.unshift(conversation);
			this.trim();
		}
		this.scheduleSave();
		this.emit();
	}

	scheduleSave(): void {
		if (this.saveTimer !== null) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.flush();
		}, this.saveDelayMs);
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.options.isPersistenceEnabled()) {
			await this.storage.remove().catch(() => undefined);
			return;
		}
		const file: StoredFile = {
			version: FILE_VERSION,
			conversations: this.list()
				// An untouched conversation is not history worth keeping.
				.filter((conversation) => conversation.messages.length > 0)
				.slice(0, this.limit),
		};
		await this.storage.write(file).catch(() => undefined);
	}

	/** Cancel pending writes; call from the plugin's `onunload`. */
	dispose(): void {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private trim(): void {
		if (this.conversations.length <= this.limit) return;
		const keep = new Set(this.list().slice(0, this.limit));
		this.conversations = this.conversations.filter((conversation) =>
			keep.has(conversation),
		);
	}
}
