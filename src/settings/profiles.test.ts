import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_IDS, type ProviderId } from '../providers/types';
import {
	BUILTIN_PROFILE_IDS,
	BUILTIN_PROFILES,
	DEFAULT_PROFILE_ID,
	ProfileRegistry,
	createCustomProfile,
	getBuiltinProfile,
	isBuiltinProfile,
	migrateTutorMode,
	resolveEffectiveSettings,
} from './profiles';
import type { AssistantProfile, ObsAideSettings, ProviderSettings } from './types';

function customFixture(id: string, overrides: Partial<AssistantProfile> = {}): AssistantProfile {
	return {
		id,
		name: id,
		icon: 'zap',
		instructions: `instructions for ${id}`,
		enabled: true,
		isBuiltIn: false,
		...overrides,
	};
}

interface SettingsHolder {
	profiles: AssistantProfile[];
	activeProfileId?: string;
}

function makeHolder(profiles: AssistantProfile[] = [], activeProfileId?: string): SettingsHolder {
	return { profiles, activeProfileId };
}

function makeRegistry(holder: SettingsHolder) {
	const save = vi.fn(async () => {});
	const registry = new ProfileRegistry(() => holder, save);
	return { registry, holder, save };
}

function providerEntry(model: string): ProviderSettings {
	return { enabled: true, apiKey: '', baseUrl: '', model };
}

function globalDefaults(): Pick<ObsAideSettings, 'defaultProvider' | 'providers' | 'responseLength'> {
	const providers = {} as Record<ProviderId, ProviderSettings>;
	for (const id of PROVIDER_IDS) {
		providers[id] = providerEntry(`model-for-${id}`);
	}
	return { defaultProvider: 'openrouter', providers, responseLength: 'normal' };
}

describe('built-in profiles', () => {
	it('ships exactly the five stable profiles in order', () => {
		const ids = BUILTIN_PROFILES.map((p) => p.id);
		expect(ids).toEqual(['general', 'tutor', 'writer', 'coding-assistant', 'researcher']);
		expect([...BUILTIN_PROFILE_IDS]).toEqual(ids);
	});

	it('are all enabled, flagged built-in, and uniquely identified', () => {
		const ids = BUILTIN_PROFILES.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const profile of BUILTIN_PROFILES) {
			expect(profile.enabled).toBe(true);
			expect(profile.isBuiltIn).toBe(true);
		}
	});

	it('all carry non-empty instructions', () => {
		for (const profile of BUILTIN_PROFILES) {
			expect(profile.instructions.trim().length).toBeGreaterThan(0);
		}
	});

	it('tutor ships a note context scope and detailed responses', () => {
		const tutor = BUILTIN_PROFILES.find((p) => p.id === 'tutor');
		expect(tutor?.contextScope).toBe('note');
		expect(tutor?.responseLength).toBe('detailed');
	});
});

describe('builtin lookups', () => {
	it('finds a built-in profile by id, and general is the default', () => {
		expect(getBuiltinProfile('researcher')?.name).toBe('Researcher');
		expect(DEFAULT_PROFILE_ID).toBe('general');
		expect(getBuiltinProfile(DEFAULT_PROFILE_ID)?.id).toBe('general');
	});

	it('returns undefined for unknown or custom ids and classifies them as non-builtin', () => {
		expect(getBuiltinProfile('custom-123')).toBeUndefined();
		expect(getBuiltinProfile('nonexistent')).toBeUndefined();
		expect(isBuiltinProfile('general')).toBe(true);
		expect(isBuiltinProfile('coding-assistant')).toBe(true);
		expect(isBuiltinProfile('custom-123')).toBe(false);
	});
});

describe('createCustomProfile', () => {
	it('trims name, icon and instructions', () => {
		const profile = createCustomProfile({
			name: '  Padded Name  ',
			icon: ' sparkles ',
			instructions: '  Be brief \n',
		});
		expect(profile.name).toBe('Padded Name');
		expect(profile.icon).toBe('sparkles');
		expect(profile.instructions).toBe('Be brief');
	});

	it('falls back to Custom/zap for blank name/icon', () => {
		const profile = createCustomProfile({ name: '   ', icon: '', instructions: '' });
		expect(profile.name).toBe('Custom');
		expect(profile.icon).toBe('zap');
		expect(profile.instructions).toBe('');
	});

	it('generates a unique custom-prefixed id and marks the profile editable', () => {
		const first = createCustomProfile({ name: 'One', icon: 'zap', instructions: 'a' });
		const second = createCustomProfile({ name: 'Two', icon: 'zap', instructions: 'b' });
		expect(first.id.startsWith('custom-')).toBe(true);
		expect(first.id).not.toBe(second.id);
		expect(first.enabled).toBe(true);
		expect(first.isBuiltIn).toBe(false);
	});

	it('preserves optional provider, model, length and scope overrides', () => {
		const profile = createCustomProfile({
			name: 'Picky',
			icon: 'cpu',
			instructions: 'Use Anthropic',
			providerId: 'anthropic',
			model: 'claude-sonnet',
			responseLength: 'short',
			contextScope: 'folder',
		});
		expect(profile.providerId).toBe('anthropic');
		expect(profile.model).toBe('claude-sonnet');
		expect(profile.responseLength).toBe('short');
		expect(profile.contextScope).toBe('folder');
	});

	it('leaves unset overrides undefined so persistence omits them', () => {
		const profile = createCustomProfile({ name: 'Bare', icon: 'zap', instructions: 'plain' });
		expect(profile.providerId).toBeUndefined();
		expect(profile.model).toBeUndefined();
		expect(profile.responseLength).toBeUndefined();
		expect(profile.contextScope).toBeUndefined();
		expect(JSON.parse(JSON.stringify(profile))).not.toHaveProperty('providerId');
	});
});

describe('ProfileRegistry reads', () => {
	it('getAll lists built-ins first, then customs', () => {
		const { registry } = makeRegistry(makeHolder([customFixture('custom-1')]));
		expect(registry.getAll().map((p) => p.id)).toEqual([...BUILTIN_PROFILE_IDS, 'custom-1']);
	});

	it('getEnabled drops disabled customs but keeps built-ins', () => {
		const { registry } = makeRegistry(
			makeHolder([
				customFixture('custom-on'),
				customFixture('custom-off', { enabled: false }),
			]),
		);
		const enabledIds = registry.getEnabled().map((p) => p.id);
		expect(enabledIds).toContain('tutor');
		expect(enabledIds).toContain('custom-on');
		expect(enabledIds).not.toContain('custom-off');
	});

	it('get resolves built-ins and customs alike', () => {
		const { registry } = makeRegistry(makeHolder([customFixture('custom-1', { name: 'Mine' })]));
		expect(registry.get('writer')).toBeDefined();
		expect(registry.get('custom-1')?.name).toBe('Mine');
		expect(registry.get('ghost')).toBeUndefined();
	});

	it('getActive honours the stored id and falls back to the default', () => {
		const unset = makeRegistry(makeHolder([customFixture('custom-1')]));
		expect(unset.registry.getActive()?.id).toBe('general');

		const dangling = makeRegistry(makeHolder([], 'gone'));
		expect(dangling.registry.getActive()?.id).toBe('general');

		const picked = makeRegistry(makeHolder([customFixture('custom-1')], 'custom-1'));
		expect(picked.registry.getActive()?.id).toBe('custom-1');
	});
});

describe('ProfileRegistry mutations', () => {
	it('add appends a custom profile and persists', () => {
		const { registry, holder, save } = makeRegistry(makeHolder());
		const profile = customFixture('custom-new', { name: 'Fresh' });
		void registry.add(profile);
		expect(holder.profiles).toEqual([profile]);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('update merges changes while pinning id and isBuiltIn', async () => {
		const { registry, holder, save } = makeRegistry(makeHolder([customFixture('custom-1')]));
		await registry.update('custom-1', { name: 'Renamed', id: 'hijacked', isBuiltIn: true });
		expect(holder.profiles[0]).toMatchObject({ id: 'custom-1', name: 'Renamed', isBuiltIn: false });
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('update throws for missing and built-in profiles', async () => {
		const { registry } = makeRegistry(makeHolder([customFixture('custom-1')]));
		await expect(registry.update('ghost', { name: 'X' })).rejects.toThrow('not found');
		await expect(registry.update('general', { name: 'X' })).rejects.toThrow();
	});

	it('delete removes a custom profile, persists, and leaves other actives alone', async () => {
		const { registry, holder, save } = makeRegistry(
			makeHolder([customFixture('custom-a'), customFixture('custom-b')], 'custom-b'),
		);
		await registry.delete('custom-a');
		expect(holder.profiles.map((p) => p.id)).toEqual(['custom-b']);
		expect(holder.activeProfileId).toBe('custom-b');
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('delete refuses built-in profiles', async () => {
		const { registry } = makeRegistry(makeHolder());
		await expect(registry.delete('tutor')).rejects.toThrow();
	});

	it('delete resets activeProfileId to the default when the active profile was deleted', async () => {
		const { registry, holder } = makeRegistry(makeHolder([customFixture('custom-a')], 'custom-a'));
		await registry.delete('custom-a');
		expect(holder.activeProfileId).toBe(DEFAULT_PROFILE_ID);
	});

	it('setActive persists the chosen profile id', async () => {
		const { registry, holder, save } = makeRegistry(makeHolder());
		await registry.setActive('tutor');
		expect(holder.activeProfileId).toBe('tutor');
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('setActive throws for missing or disabled profiles', async () => {
		const { registry } = makeRegistry(
			makeHolder([customFixture('custom-off', { enabled: false })]),
		);
		await expect(registry.setActive('custom-off')).rejects.toThrow('disabled');
		await expect(registry.setActive('ghost')).rejects.toThrow();
	});

	it('duplicate copies the source into a new enabled custom profile and stores it', async () => {
		const { registry, holder, save } = makeRegistry(
			makeHolder([
				customFixture('custom-src', {
					name: 'Sourcery',
					icon: 'target',
					instructions: 'be sour',
					providerId: 'anthropic',
					model: 'claude-sonnet',
					responseLength: 'short',
					contextScope: 'folder',
				}),
			]),
		);
		const copy = await registry.duplicate('custom-src');
		expect(copy.name).toBe('Sourcery (copy)');
		expect(copy.icon).toBe('target');
		expect(copy.instructions).toBe('be sour');
		expect(copy.providerId).toBe('anthropic');
		expect(copy.model).toBe('claude-sonnet');
		expect(copy.responseLength).toBe('short');
		expect(copy.contextScope).toBe('folder');
		expect(copy.enabled).toBe(true);
		expect(copy.isBuiltIn).toBe(false);
		expect(copy.id.startsWith('custom-')).toBe(true);
		expect(copy.id).not.toBe('custom-src');
		expect(holder.profiles.at(-1)).toBe(copy);
		expect(save).toHaveBeenCalledTimes(1);
	});
});

describe('resolveEffectiveSettings', () => {
	it('lets profile overrides win over the globals', () => {
		const effective = resolveEffectiveSettings(
			{
				...customFixture('custom-1'),
				providerId: 'anthropic',
				model: 'claude-sonnet',
				responseLength: 'short',
			},
			globalDefaults(),
		);
		expect(effective).toEqual({
			providerId: 'anthropic',
			model: 'claude-sonnet',
			responseLength: 'short',
		});
	});

	it('falls back to the pinned provider model when the profile model is blank', () => {
		const globals = globalDefaults();
		const blank = resolveEffectiveSettings(
			{ ...customFixture('custom-1'), providerId: 'anthropic', model: '' },
			globals,
		);
		const whitespace = resolveEffectiveSettings(
			{ ...customFixture('custom-2'), providerId: 'anthropic', model: '   ' },
			globals,
		);
		expect(blank.model).toBe(globals.providers['anthropic'].model);
		expect(whitespace.model).toBe(globals.providers['anthropic'].model);
	});

	it('fills only the gaps a profile leaves unset', () => {
		const effective = resolveEffectiveSettings(
			{ ...customFixture('custom-1'), providerId: 'gemini' },
			globalDefaults(),
		);
		expect(effective.providerId).toBe('gemini');
		expect(effective.model).toBe(globalDefaults().providers['gemini'].model);
		expect(effective.responseLength).toBe('normal');
	});

	it('uses global defaults entirely for an undefined profile', () => {
		expect(resolveEffectiveSettings(undefined, globalDefaults())).toEqual({
			providerId: 'openrouter',
			model: 'model-for-openrouter',
			responseLength: 'normal',
		});
	});
});

describe('migrateTutorMode', () => {
	it('points activeProfileId at tutor when tutor mode was on with no profile yet', () => {
		expect(migrateTutorMode({ tutorModeByDefault: true })).toEqual({ activeProfileId: 'tutor' });
	});

	it('leaves settings alone when a profile is already active', () => {
		expect(migrateTutorMode({ tutorModeByDefault: true, activeProfileId: 'writer' })).toEqual({});
	});

	it('leaves settings alone when tutor mode was off', () => {
		expect(migrateTutorMode({ tutorModeByDefault: false })).toEqual({});
	});
});
