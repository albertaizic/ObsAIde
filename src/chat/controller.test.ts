import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatController, type ChatChangeReason, type ChatControllerDeps } from './controller';
import { createMessage, effectiveContextScope, type Conversation } from './conversation';
import { ConversationStore, type ConversationStorage } from './store';
import { createDefaultSettings, type ObsAideSettings } from '../settings/types';

// controller.ts value-imports the context resolver, whose own import graph
// reaches Obsidian vault APIs that nothing here executes (no attachments are
// ever sent). Stubbing this one boundary keeps the module loadable under vitest.
vi.mock('../context/resolve', () => ({
	buildContextBlock: async () => ({ block: '', parts: [] }),
}));

const stores: ConversationStore[] = [];

function makeHarness(
	prepare?: (deps: { store: ConversationStore; settings: ObsAideSettings }) => void,
) {
	const settings = createDefaultSettings();
	settings.profiles = [];
	const saveSettings = vi.fn(async () => {});
	const storage: ConversationStorage & { saved: unknown } = {
		read: async () => null,
		write: async (data) => {
			storage.saved = data;
		},
		remove: async () => {},
		saved: undefined,
	};
	const store = new ConversationStore(storage, {
		isPersistenceEnabled: () => true,
		saveDelayMs: 60_000,
	});
	stores.push(store);

	prepare?.({ store, settings });

	const controller = new ChatController({
		app: {} as unknown as ChatControllerDeps['app'],
		providers: {} as unknown as ChatControllerDeps['providers'],
		store,
		editTargets: {
			remember() {},
			recall() {
				return null;
			},
		} as unknown as ChatControllerDeps['editTargets'],
		getSettings: () => settings,
		saveSettings,
	});
	return { controller, store, settings, saveSettings };
}

afterEach(() => {
	for (const store of stores.splice(0)) store.dispose();
});

function collectReasons(controller: ChatController): ChatChangeReason[] {
	const reasons: ChatChangeReason[] = [];
	controller.onChange((reason) => reasons.push(reason));
	return reasons;
}

describe('ChatController construction', () => {
	it('adopts the most recent stored conversation and stamps the active profile when unset', () => {
		let seeded: Conversation | undefined;
		const { controller } = makeHarness(({ store }) => {
			seeded = store.create('chat');
			seeded.messages.push(createMessage('user', 'earlier turn'));
		});

		expect(controller.current).toBe(seeded);
		expect(controller.current.activeProfileId).toBe('general');
		expect(controller.isGenerating).toBe(false);
	});

	it('keeps an active profile already stored on the adopted conversation', () => {
		const { controller } = makeHarness(({ store }) => {
			const seeded = store.create('chat');
			seeded.activeProfileId = 'writer';
			seeded.messages.push(createMessage('user', 'earlier turn'));
		});

		expect(controller.current.activeProfileId).toBe('writer');
	});

	it('starts in tutor mode when the active profile is the tutor', () => {
		const { controller } = makeHarness(({ settings }) => {
			settings.activeProfileId = 'tutor';
		});

		expect(controller.current.mode).toBe('tutor');
		expect(controller.current.activeProfileId).toBe('tutor');
	});

	it('honours tutorModeByDefault for non-tutor profiles', () => {
		const { controller } = makeHarness(({ settings }) => {
			settings.tutorModeByDefault = true;
		});

		expect(controller.current.mode).toBe('tutor');
	});
});

describe('newConversation', () => {
	it('creates a fresh conversation stamped with the active profile and the global context scope', () => {
		const { controller, store, settings } = makeHarness();
		controller.current.messages.push(createMessage('user', 'hello'));
		settings.contextScope = 'note';

		controller.newConversation();

		expect(controller.current.messages).toEqual([]);
		expect(controller.current.mode).toBe('chat');
		expect(controller.current.activeProfileId).toBe('general');
		expect(controller.current.contextScope).toBe('note');
		// The previous conversation is still in the history, newest first.
		expect(store.list()).toHaveLength(2);
		expect(store.list()[0]?.id).toBe(controller.current.id);
	});

	it("prefers the profile's context scope over the global default", () => {
		const { controller, settings } = makeHarness(({ settings }) => {
			settings.contextScope = 'none';
			settings.profiles = [
				{
					id: 'custom-scope',
					name: 'Scoped',
					icon: 'zap',
					instructions: '',
					enabled: true,
					isBuiltIn: false,
					contextScope: 'folder',
				},
			];
			settings.activeProfileId = 'custom-scope';
		});
		controller.current.messages.push(createMessage('user', 'hello'));

		controller.newConversation();

		expect(controller.current.contextScope).toBe('folder');
		expect(controller.current.activeProfileId).toBe('custom-scope');
		expect(controller.current.mode).toBe('chat');
		expect(settings.contextScope).toBe('none');
	});

	it('reuses an empty conversation instead of creating a duplicate', () => {
		const { controller, store, settings } = makeHarness();
		const firstId = controller.current.id;
		const reasons = collectReasons(controller);
		settings.activeProfileId = 'tutor';

		controller.newConversation();

		expect(controller.current.id).toBe(firstId);
		expect(controller.current.messages).toEqual([]);
		expect(controller.current.mode).toBe('tutor');
		expect(store.list()).toHaveLength(1);
		expect(reasons).toEqual(['conversation']);
	});

	it('reusing an empty conversation keeps an existing profile', () => {
		const { controller, settings } = makeHarness();
		controller.current.activeProfileId = 'writer';
		settings.activeProfileId = 'tutor';

		controller.newConversation();

		expect(controller.current.mode).toBe('tutor');
		expect(controller.current.activeProfileId).toBe('writer');
	});

	it('stamps the active profile when the reused conversation has none', () => {
		const { controller, settings } = makeHarness();
		controller.current.activeProfileId = undefined;
		settings.activeProfileId = 'writer';

		controller.newConversation();

		expect(controller.current.mode).toBe('chat');
		expect(controller.current.activeProfileId).toBe('writer');
	});
});

describe('setConversationProfile', () => {
	it('pins the profile on the current conversation only and emits structure', () => {
		const { controller, store } = makeHarness();
		controller.current.messages.push(createMessage('user', 'hello'));
		const previousId = controller.current.id;
		controller.newConversation();
		const reasons = collectReasons(controller);

		controller.setConversationProfile('tutor');

		expect(controller.current.activeProfileId).toBe('tutor');
		expect(store.get(previousId)?.activeProfileId).toBe('general');
		expect(reasons).toEqual(['structure']);
	});
});

describe('setContextScope', () => {
	it('writes only the conversation scope and persists it with a touch', () => {
		const { controller, store, settings, saveSettings } = makeHarness();
		settings.contextScope = 'note';
		// A clearly stale timestamp makes the bump from `touch` observable.
		controller.current.updatedAt = 1000;
		const reasons = collectReasons(controller);

		controller.setContextScope('folder');

		expect(controller.current.contextScope).toBe('folder');
		expect(settings.contextScope).toBe('note');
		expect(saveSettings).not.toHaveBeenCalled();
		const stored = store.list()[0];
		expect(stored?.id).toBe(controller.current.id);
		expect(stored?.contextScope).toBe('folder');
		expect(stored ? stored.updatedAt > 1000 : false).toBe(true);
		expect(reasons).toEqual(['structure']);
	});
});

describe('effectiveContextScope', () => {
	it('prefers the scope stored on the conversation', () => {
		expect(effectiveContextScope({ contextScope: 'section' }, 'note')).toBe('section');
	});

	it('falls back to the global default when no scope is stored', () => {
		expect(effectiveContextScope({}, 'linked')).toBe('linked');
	});
});

describe('deleteConversation', () => {
	it('deleting a non-current conversation leaves the active one untouched', () => {
		const { controller, store } = makeHarness(({ store }) => {
			store.create('chat').messages.push(createMessage('user', 'first'));
			store.create('chat').messages.push(createMessage('user', 'second'));
		});
		const currentId = controller.current.id;
		const reasons = collectReasons(controller);

		const victim = store.list().find(c => c.id !== currentId)!;
		controller.deleteConversation(victim.id);

		expect(controller.current.id).toBe(currentId);
		expect(store.get(currentId)).toBeDefined();
		// Nothing about the open transcript changed, so no view-level event.
		expect(reasons).toEqual([]);
	});

	it('re-registers an orphaned empty conversation instead of keeping it detached', () => {
		const { controller, store } = makeHarness();
		// Simulate Settings → "Delete conversation history": the store empties
		// while the (empty) current conversation object stays in memory.
		store.clear();

		controller.newConversation();

		expect(store.get(controller.current.id)).toBeDefined();
		expect(store.list()).toHaveLength(1);
	});

	it('deleting the current conversation loads the newest remaining one', () => {
		const { controller, store } = makeHarness(({ store }) => {
			store.create('chat').messages.push(createMessage('user', 'first'));
			store.create('chat').messages.push(createMessage('user', 'second'));
		});
		// Constructor adopted the newest ("second"); open "first", then create
		// one more so deleting it must fall back to "second", not to nothing.
		const oldest = store.list().at(-1)!;
		controller.openConversation(oldest.id);
		const deletedId = controller.current.id;

		controller.deleteConversation(deletedId);

		expect(store.get(deletedId)).toBeUndefined();
		expect(controller.current.id).not.toBe(deletedId);
		expect(controller.current).toBe(store.list()[0]);
	});

	it('deleting the current branch marks the parent as current again when it is newest', () => {
		const { controller, store } = makeHarness();
		controller.current.messages.push(createMessage('user', 'parent turn'));
		controller.branchFromMessage(controller.current.messages[0]!.id);
		const branchId = controller.current.id;

		controller.deleteConversation(branchId);

		expect(store.get(branchId)).toBeUndefined();
		expect(controller.current.parentConversationId).toBeUndefined();
		expect(controller.current.messages.length).toBe(1);
	});

	it('deleting the last stored conversation lands on a fresh stamped conversation', () => {
		const { controller, settings } = makeHarness();
		settings.contextScope = 'section';
		const doomedId = controller.current.id;
		controller.current.messages.push(createMessage('user', 'only conversation'));

		controller.deleteConversation(doomedId);

		expect(controller.current.id).not.toBe(doomedId);
		expect(controller.current.messages).toEqual([]);
		expect(controller.current.activeProfileId).toBe('general');
		expect(controller.current.contextScope).toBe('section');
	});

	it('never leaves a deleted conversation as current', () => {
		const { controller, store } = makeHarness();
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			controller.newConversation();
			controller.current.messages.push(createMessage('user', `turn ${i}`));
			ids.push(controller.current.id);
		}
		for (const id of ids) {
			if (!store.get(id)) continue;
			controller.deleteConversation(id);
			expect(store.get(controller.current.id)).toBeDefined();
		}
	});
});

describe('generation edges', () => {
	it('regenerate is a no-op when there is no assistant reply', async () => {
		const { controller } = makeHarness();
		controller.current.messages.push(createMessage('user', 'only question'));
		const snapshot = [...controller.current.messages];

		await controller.regenerate();

		expect(controller.current.messages).toEqual(snapshot);
		expect(controller.isGenerating).toBe(false);
		expect(controller.generatingMessage).toBeNull();
	});

	it('regenerate is a no-op on an empty conversation', async () => {
		const { controller } = makeHarness();

		await expect(controller.regenerate()).resolves.toBeUndefined();
		expect(controller.current.messages).toEqual([]);
	});

	it('stop before any generation does not throw', () => {
		const { controller } = makeHarness();

		expect(() => controller.stop()).not.toThrow();
		expect(controller.isGenerating).toBe(false);
	});
});
