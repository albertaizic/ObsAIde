import { describe, expect, it, vi } from 'vitest';
import { createMessage } from './conversation';
import { ConversationStore, type ConversationStorage } from './store';

interface FakeStorage extends ConversationStorage {
	data: unknown;
	removed: boolean;
}

function createStorage(initial?: unknown): FakeStorage {
	return {
		data: initial,
		removed: false,
		read(): Promise<unknown> {
			return Promise.resolve(this.data);
		},
		write(data: unknown): Promise<void> {
			this.data = data;
			return Promise.resolve();
		},
		remove(): Promise<void> {
			this.removed = true;
			this.data = undefined;
			return Promise.resolve();
		},
	};
}

function createStore(storage: ConversationStorage, enabled = true): ConversationStore {
	return new ConversationStore(storage, {
		isPersistenceEnabled: () => enabled,
		saveDelayMs: 0,
		limit: 3,
	});
}

describe('ConversationStore', () => {
	it('loads stored conversations and rejects malformed ones', async () => {
		const storage = createStorage({
			version: 1,
			conversations: [
				{ id: 'a', messages: [], updatedAt: 2, createdAt: 1, title: '', mode: 'chat' },
				{ id: 'broken' },
				'nope',
			],
		});
		const store = createStore(storage);
		await store.load();
		expect(store.list().map((conversation) => conversation.id)).toEqual(['a']);
	});

	it('survives an unreadable history file', async () => {
		const storage = createStorage();
		storage.read = () => Promise.reject(new Error('corrupt'));
		const store = createStore(storage);
		await store.load();
		expect(store.list()).toEqual([]);
	});

	it('writes conversations on flush', async () => {
		const storage = createStorage();
		const store = createStore(storage);
		await store.load();

		const conversation = store.create('chat');
		conversation.messages.push(createMessage('user', 'hello'));
		store.touch(conversation);
		await store.flush();

		expect(storage.data).toMatchObject({
			version: 1,
			conversations: [{ id: conversation.id }],
		});
	});

	it('keeps only the most recent conversations', async () => {
		const store = createStore(createStorage());
		await store.load();
		for (let index = 0; index < 5; index += 1) {
			const conversation = store.create('chat');
			conversation.updatedAt = index;
		}
		expect(store.list()).toHaveLength(3);
	});

	it('deletes the file when persistence is switched off', async () => {
		const storage = createStorage({ version: 1, conversations: [] });
		const store = createStore(storage, false);
		await store.load();
		await store.flush();
		expect(storage.removed).toBe(true);
	});

	it('cancels pending writes when disposed', async () => {
		vi.useFakeTimers();
		try {
			const storage = createStorage();
			const write = vi.spyOn(storage, 'write');
			const store = new ConversationStore(storage, {
				isPersistenceEnabled: () => true,
				saveDelayMs: 1000,
			});
			await store.load();
			store.create('chat');
			store.dispose();
			vi.advanceTimersByTime(5000);
			expect(write).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('returns a fresh conversation when there is no history', async () => {
		const store = createStore(createStorage());
		await store.load();
		expect(store.mostRecent('tutor').mode).toBe('tutor');
	});
});
