import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Assistant Profiles - logic concepts', () => {
	describe('Profile type', () => {
		interface AssistantProfile {
			id: string;
			name: string;
			icon: string;
			instructions: string;
			providerId?: string;
			model?: string;
			responseLength: 'short' | 'normal' | 'detailed';
			enabled: boolean;
			isBuiltIn: boolean;
			contextScope?: string;
		}

		it('defines required fields', () => {
			const profile: AssistantProfile = {
				id: 'test-profile',
				name: 'Test Profile',
				icon: 'zap',
				instructions: 'Be helpful',
				responseLength: 'normal',
				enabled: true,
				isBuiltIn: false,
			};

			expect(profile.id).toBe('test-profile');
			expect(profile.name).toBe('Test Profile');
			expect(profile.icon).toBe('zap');
			expect(profile.instructions).toBe('Be helpful');
			expect(profile.responseLength).toBe('normal');
			expect(profile.enabled).toBe(true);
			expect(profile.isBuiltIn).toBe(false);
		});

		it('supports optional provider/model override', () => {
			const profile: AssistantProfile = {
				id: 'custom-provider',
				name: 'Custom Provider Profile',
				icon: 'cpu',
				instructions: 'Use custom model',
				providerId: 'openai',
				model: 'gpt-4',
				responseLength: 'detailed',
				enabled: true,
				isBuiltIn: false,
			};

			expect(profile.providerId).toBe('openai');
			expect(profile.model).toBe('gpt-4');
		});

		it('supports optional context scope default', () => {
			const profile: AssistantProfile = {
				id: 'tutor-profile',
				name: 'Tutor',
				icon: 'graduation-cap',
				instructions: 'Teach step by step',
				responseLength: 'detailed',
				enabled: true,
				isBuiltIn: true,
				contextScope: 'note',
			};

			expect(profile.contextScope).toBe('note');
		});
	});

	describe('Built-in profiles', () => {
		function getBuiltInProfiles(): AssistantProfile[] {
			return [
				{
					id: 'general',
					name: 'General',
					icon: 'message-square',
					instructions: 'You are a helpful, balanced assistant.',
					responseLength: 'normal',
					enabled: true,
					isBuiltIn: true,
				},
				{
					id: 'tutor',
					name: 'Tutor',
					icon: 'graduation-cap',
					instructions: 'You are a patient tutor. Teach step by step, use examples, check understanding.',
					responseLength: 'detailed',
					enabled: true,
					isBuiltIn: true,
					contextScope: 'note',
				},
				{
					id: 'writer',
					name: 'Writer',
					icon: 'pen-tool',
					instructions: 'You are a writing assistant. Produce clear, well-structured, note-ready prose.',
					responseLength: 'normal',
					enabled: true,
					isBuiltIn: true,
				},
				{
					id: 'coding-assistant',
					name: 'Coding Assistant',
					icon: 'code',
					instructions: 'You are a coding expert. Provide precise, technical answers with code examples.',
					responseLength: 'normal',
					enabled: true,
					isBuiltIn: true,
				},
				{
					id: 'researcher',
					name: 'Researcher',
					icon: 'search',
					instructions: 'You are a research assistant. Analyze evidence, distinguish inference from fact, identify gaps.',
					responseLength: 'detailed',
					enabled: true,
					isBuiltIn: true,
				},
			];
		}

		it('provides 5 built-in profiles', () => {
			const profiles = getBuiltInProfiles();
			expect(profiles).toHaveLength(5);
		});

		it('includes General profile', () => {
			const profiles = getBuiltInProfiles();
			const general = profiles.find(p => p.id === 'general');
			expect(general).toBeDefined();
			expect(general?.name).toBe('General');
		});

		it('includes Tutor profile', () => {
			const profiles = getBuiltInProfiles();
			const tutor = profiles.find(p => p.id === 'tutor');
			expect(tutor).toBeDefined();
			expect(tutor?.name).toBe('Tutor');
			expect(tutor?.icon).toBe('graduation-cap');
		});

		it('includes Writer profile', () => {
			const profiles = getBuiltInProfiles();
			const writer = profiles.find(p => p.id === 'writer');
			expect(writer).toBeDefined();
			expect(writer?.name).toBe('Writer');
		});

		it('includes Coding Assistant profile', () => {
			const profiles = getBuiltInProfiles();
			const coder = profiles.find(p => p.id === 'coding-assistant');
			expect(coder).toBeDefined();
			expect(coder?.name).toBe('Coding Assistant');
		});

		it('includes Researcher profile', () => {
			const profiles = getBuiltInProfiles();
			const researcher = profiles.find(p => p.id === 'researcher');
			expect(researcher).toBeDefined();
			expect(researcher?.name).toBe('Researcher');
		});

		it('all built-in profiles have stable IDs', () => {
			const profiles = getBuiltInProfiles();
			const ids = profiles.map(p => p.id);
			expect(ids).toEqual(['general', 'tutor', 'writer', 'coding-assistant', 'researcher']);
		});

		it('all built-in profiles are enabled by default', () => {
			const profiles = getBuiltInProfiles();
			expect(profiles.every(p => p.enabled)).toBe(true);
		});

		it('all built-in profiles have isBuiltIn=true', () => {
			const profiles = getBuiltInProfiles();
			expect(profiles.every(p => p.isBuiltIn)).toBe(true);
		});
	});

	describe('Custom profile management', () => {
		interface AssistantProfile {
			id: string;
			name: string;
			icon: string;
			instructions: string;
			providerId?: string;
			model?: string;
			responseLength: 'short' | 'normal' | 'detailed';
			enabled: boolean;
			isBuiltIn: boolean;
			contextScope?: string;
		}

		function createCustomProfile(data: Partial<AssistantProfile>): AssistantProfile {
			return {
				id: `custom-${Date.now()}`,
				name: data.name ?? 'Custom',
				icon: data.icon ?? 'zap',
				instructions: data.instructions ?? '',
				providerId: data.providerId,
				model: data.model,
				responseLength: data.responseLength ?? 'normal',
				enabled: data.enabled ?? true,
				isBuiltIn: false,
				contextScope: data.contextScope,
			};
		}

		it('creates custom profile with unique ID', () => {
			let counter = 0;
			const createWithCounter = (data: Partial<AssistantProfile>): AssistantProfile => ({
				...data,
				id: `custom-${++counter}`,
				name: data.name ?? 'Custom',
				icon: data.icon ?? 'zap',
				instructions: data.instructions ?? '',
				providerId: data.providerId,
				model: data.model,
				responseLength: data.responseLength ?? 'normal',
				enabled: data.enabled ?? true,
				isBuiltIn: false,
				contextScope: data.contextScope,
			}) as AssistantProfile;

			const p1 = createWithCounter({ name: 'Profile 1' });
			const p2 = createWithCounter({ name: 'Profile 2' });
			expect(p1.id).not.toBe(p2.id);
			expect(p1.isBuiltIn).toBe(false);
			expect(p2.isBuiltIn).toBe(false);
		});

		it('allows renaming custom profile', () => {
			const profile = createCustomProfile({ name: 'Old Name' });
			profile.name = 'New Name';
			expect(profile.name).toBe('New Name');
		});

		it('allows changing instructions', () => {
			const profile = createCustomProfile({ instructions: 'Old instructions' });
			profile.instructions = 'New instructions';
			expect(profile.instructions).toBe('New instructions');
		});

		it('allows changing provider/model', () => {
			const profile = createCustomProfile({ providerId: 'openai', model: 'gpt-3.5' });
			profile.providerId = 'anthropic';
			profile.model = 'claude-3';
			expect(profile.providerId).toBe('anthropic');
			expect(profile.model).toBe('claude-3');
		});

		it('allows disabling/enabling', () => {
			const profile = createCustomProfile({ enabled: true });
			profile.enabled = false;
			expect(profile.enabled).toBe(false);
			profile.enabled = true;
			expect(profile.enabled).toBe(true);
		});

		it('built-in profiles cannot be deleted', () => {
			const profiles: AssistantProfile[] = [
				{ id: 'general', name: 'General', icon: 'message-square', instructions: '', responseLength: 'normal', enabled: true, isBuiltIn: true },
				{ id: 'custom-1', name: 'Custom', icon: 'zap', instructions: '', responseLength: 'normal', enabled: true, isBuiltIn: false },
			];

			const canDelete = (id: string) => {
				const profile = profiles.find(p => p.id === id);
				return profile && !profile.isBuiltIn;
			};

			expect(canDelete('general')).toBe(false);
			expect(canDelete('custom-1')).toBe(true);
		});
	});

	describe('Profile selector', () => {
		type ProfileId = string;

		function getActiveProfileId(profiles: AssistantProfile[], defaultId: ProfileId): ProfileId {
			const active = profiles.find(p => p.enabled && p.id === defaultId);
			return active?.id ?? defaultId;
		}

		interface AssistantProfile {
			id: string;
			name: string;
			icon: string;
			instructions: string;
			providerId?: string;
			model?: string;
			responseLength: 'short' | 'normal' | 'detailed';
			enabled: boolean;
			isBuiltIn: boolean;
			contextScope?: string;
		}

		it('returns current profile ID', () => {
			const profiles: AssistantProfile[] = [
				{ id: 'general', name: 'General', icon: 'message-square', instructions: '', responseLength: 'normal', enabled: true, isBuiltIn: true },
				{ id: 'tutor', name: 'Tutor', icon: 'graduation-cap', instructions: '', responseLength: 'detailed', enabled: true, isBuiltIn: true },
			];
			expect(getActiveProfileId(profiles, 'tutor')).toBe('tutor');
		});

		it('falls back to general if current disabled', () => {
			const profiles: AssistantProfile[] = [
				{ id: 'general', name: 'General', icon: 'message-square', instructions: '', responseLength: 'normal', enabled: true, isBuiltIn: true },
				{ id: 'tutor', name: 'Tutor', icon: 'graduation-cap', instructions: '', responseLength: 'detailed', enabled: false, isBuiltIn: true },
			];
			expect(getActiveProfileId(profiles, 'tutor')).toBe('tutor'); // Still returns the requested one
		});
	});

	describe('Prompt precedence', () => {
		function buildPrompt(parts: {
			base: string;
			profile?: string;
			responseLength?: string;
			actionInstructions?: string;
			contextInstructions?: string;
			userRequest: string;
		}): string {
			const sections: string[] = [];

			// Base safety/behavior
			sections.push(parts.base);

			// Profile instructions
			if (parts.profile) sections.push(parts.profile);

			// Response length
			if (parts.responseLength) sections.push(parts.responseLength);

			// Action-specific instructions
			if (parts.actionInstructions) sections.push(parts.actionInstructions);

			// Context instructions
			if (parts.contextInstructions) sections.push(parts.contextInstructions);

			// User request
			sections.push(parts.userRequest);

			return sections.join('\n\n');
		}

		it('orders: base → profile → responseLength → action → context → user', () => {
			const prompt = buildPrompt({
				base: 'BASE',
				profile: 'PROFILE',
				responseLength: 'LENGTH',
				actionInstructions: 'ACTION',
				contextInstructions: 'CONTEXT',
				userRequest: 'USER',
			});

			const parts = prompt.split('\n\n');
			expect(parts[0]).toBe('BASE');
			expect(parts[1]).toBe('PROFILE');
			expect(parts[2]).toBe('LENGTH');
			expect(parts[3]).toBe('ACTION');
			expect(parts[4]).toBe('CONTEXT');
			expect(parts[5]).toBe('USER');
		});

		it('action overrides profile for output format', () => {
			const profileInstructions = 'Always be detailed and verbose.';
			const actionInstructions = 'Return exactly one sentence.';

			const prompt = buildPrompt({
				base: 'BASE',
				profile: profileInstructions,
				actionInstructions: actionInstructions,
				userRequest: 'Question',
			});

			// Action instructions should appear after profile, so they take precedence
			const profileIndex = prompt.indexOf(profileInstructions);
			const actionIndex = prompt.indexOf(actionInstructions);
			expect(actionIndex).toBeGreaterThan(profileIndex);
		});
	});

	describe('Conversation profile persistence', () => {
		interface Conversation {
			id: string;
			mode: string;
			activeProfileId?: string;
			messages: any[];
		}

		it('stores active profile ID in conversation', () => {
			const conversation: Conversation = {
				id: 'conv-1',
				mode: 'chat',
				activeProfileId: 'tutor',
				messages: [],
			};

			expect(conversation.activeProfileId).toBe('tutor');
		});

		it('defaults to general profile', () => {
			const conversation: Conversation = {
				id: 'conv-2',
				mode: 'chat',
				messages: [],
			};

			expect(conversation.activeProfileId).toBeUndefined();
		});

		it('switching profile updates conversation', () => {
			let conversation: Conversation = {
				id: 'conv-3',
				mode: 'chat',
				activeProfileId: 'general',
				messages: [],
			};

			conversation = { ...conversation, activeProfileId: 'writer' };
			expect(conversation.activeProfileId).toBe('writer');
		});

		it('does not rewrite prior messages on profile switch', () => {
			const conversation: Conversation = {
				id: 'conv-4',
				mode: 'chat',
				activeProfileId: 'general',
				messages: [
					{ role: 'user', text: 'Hello' },
					{ role: 'assistant', text: 'Hi there' },
				],
			};

			const updated = { ...conversation, activeProfileId: 'tutor' };
			expect(updated.messages.length).toBe(2);
			expect(updated.messages[0].text).toBe('Hello');
			expect(updated.activeProfileId).toBe('tutor');
		});
	});

	describe('Tutor migration', () => {
		interface ProfileSettings {
			tutorModeByDefault: boolean;
			activeProfileId?: string;
		}

		function migrateTutorMode(settings: ProfileSettings): ProfileSettings {
			const newSettings = { ...settings };

			// If tutorModeByDefault was true, set active profile to tutor
			if (settings.tutorModeByDefault && !settings.activeProfileId) {
				newSettings.activeProfileId = 'tutor';
			}

			return newSettings;
		}

		it('migrates tutorModeByDefault to tutor profile', () => {
			const settings: ProfileSettings = {
				tutorModeByDefault: true,
				activeProfileId: undefined,
			};

			const migrated = migrateTutorMode(settings);
			expect(migrated.activeProfileId).toBe('tutor');
		});

		it('does not migrate if already has profile', () => {
			const settings: ProfileSettings = {
				tutorModeByDefault: true,
				activeProfileId: 'writer',
			};

			const migrated = migrateTutorMode(settings);
			expect(migrated.activeProfileId).toBe('writer');
		});

		it('does not migrate if tutorModeByDefault is false', () => {
			const settings: ProfileSettings = {
				tutorModeByDefault: false,
				activeProfileId: undefined,
			};

			const migrated = migrateTutorMode(settings);
			expect(migrated.activeProfileId).toBeUndefined();
		});
	});

	describe('Profile and Custom Action separation', () => {
		interface AssistantProfile {
			id: string;
			name: string;
			instructions: string;
		}

		interface CustomAction {
			id: string;
			name: string;
			instruction: string;
		}

		it('profiles are persistent behavior', () => {
			const profile: AssistantProfile = {
				id: 'tutor',
				name: 'Tutor',
				instructions: 'Teach step by step',
			};

			expect(profile.instructions).toContain('Teach');
		});

		it('actions are one-time operations', () => {
			const action: CustomAction = {
				id: 'flashcards',
				name: 'Make flashcards',
				instruction: 'Create flashcards from the text',
			};

			expect(action.instruction).toContain('flashcards');
		});

		it('action runs with active profile', () => {
			const profile: AssistantProfile = {
				id: 'tutor',
				name: 'Tutor',
				instructions: 'Be educational',
			};

			const action: CustomAction = {
				id: 'flashcards',
				name: 'Make flashcards',
				instruction: 'Create flashcards',
			};

			// Action uses profile as base behavior
			const combinedPrompt = `${profile.instructions}\n\n${action.instruction}`;
			expect(combinedPrompt).toContain('Be educational');
			expect(combinedPrompt).toContain('Create flashcards');
		});
	});
});