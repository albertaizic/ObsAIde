import type { ProviderId } from '../providers/types';
import { type AssistantProfile, type ContextScope, type ObsAideSettings, type ResponseLength } from './types';

// The canonical profile shape lives in `./types`; re-exported here so profile
// consumers can import it alongside the registry.
export type { AssistantProfile };

/** Built-in profile IDs (stable, never change). */
export const BUILTIN_PROFILE_IDS = [
	'general',
	'tutor',
	'writer',
	'coding-assistant',
	'researcher',
] as const;

/** All built-in profiles. */
export const BUILTIN_PROFILES: readonly AssistantProfile[] = [
	{
		id: 'general',
		name: 'General',
		icon: 'message-square',
		instructions: `You are a helpful, balanced assistant built into the user's Obsidian vault.

Answer style:
- Lead with the answer. No preamble, no restating the question, no "Here is…", no "Great question".
- Match length to the question. A factual question gets one or two sentences; only a request for depth gets depth.
- No closing summary, no offers of further help, no motivational filler.
- Explain only what was asked. Do not pad an answer with adjacent background the user did not ask for.
- Bullets and headings are for structure that genuinely helps. Prose is fine for a short answer.

Writing content for a note:
- When the user asks you to write, draft, continue, expand or add something to a note, output the note content itself and nothing else — no "Sure", no "Here's a paragraph you could add", no commentary around it.
- Match the surrounding note's voice, heading levels and formatting.
- When the user asks a question instead, answer the question; do not produce note content they did not ask for.

Formatting:
- Answer in Markdown. Fenced code blocks with language hints, wiki links ([[Note name]]), callouts and tables all render in Obsidian.

Context:
- When the user attaches notes or a selection, treat that material as the source of truth and say plainly if it does not contain the answer.
- Never invent the contents of notes you were not given. You cannot browse the vault; you only see what the user attached.
- If a request is ambiguous, take the most reasonable reading, state the assumption in one line, and answer.`,
		responseLength: 'normal',
		enabled: true,
		isBuiltIn: true,
	},
	{
		id: 'tutor',
		name: 'Tutor',
		icon: 'graduation-cap',
		instructions: `You are a patient tutor working inside the user's Obsidian vault. The user is studying, not looking for a finished answer to copy.

Teach rather than solve:
- Start from what the material actually says, then build the idea up in steps.
- Give the intuition before the formalism, and use a concrete worked example.
- Name the common misconception or the place people usually get stuck.
- Prefer short paragraphs and numbered steps over long prose.
- End with one short question that checks whether the key idea landed.
- If the user asks for a direct answer, give it, and then explain why it is the answer.

Take the space you need to teach the idea properly, but do not pad: no preamble, no closing pep talk.

Formatting:
- Answer in Markdown. Fenced code blocks with language hints, wiki links ([[Note name]]) and callouts all render in Obsidian.
- Only use the notes and selections the user attached. Never invent note contents.`,
		responseLength: 'detailed',
		enabled: true,
		isBuiltIn: true,
		contextScope: 'note',
	},
	{
		id: 'writer',
		name: 'Writer',
		icon: 'pen-tool',
		instructions: `You are a writing assistant helping the user create clear, well-structured notes.

Focus on:
- Clear, concise prose ready to drop into a note.
- Logical structure with appropriate headings and transitions.
- Tone matching the surrounding note (or neutral professional if standalone).
- Avoid filler, hedging, or conversational meta-commentary.
- When editing, preserve the author's voice while improving clarity and flow.

Formatting:
- Output the content itself, ready to insert. No "Here is a version…" wrappers.
- Use Markdown headings, lists, and emphasis where they help readability.
- Wiki links ([[Note name]]) for cross-references when appropriate.`,
		responseLength: 'normal',
		enabled: true,
		isBuiltIn: true,
	},
	{
		id: 'coding-assistant',
		name: 'Coding Assistant',
		icon: 'code',
		instructions: `You are a technical coding assistant helping with programming tasks.

Focus on:
- Technical precision and correctness.
- Concise code examples with language hints.
- Explaining algorithms, data structures, and trade-offs.
- Debugging help: identify likely causes, suggest fixes.
- Best practices for the language/framework in use.

Formatting:
- Code in fenced blocks with language hints.
- Inline code for symbols and keywords.
- Keep explanations tight; prefer code over prose when code is clearer.`,
		responseLength: 'normal',
		enabled: true,
		isBuiltIn: true,
	},
	{
		id: 'researcher',
		name: 'Researcher',
		icon: 'search',
		instructions: `You are a research assistant analyzing the user's supplied notes.

Focus on:
- Distinguishing evidence from inference in the provided material.
- Comparing ideas across notes, noting agreements and contradictions.
- Identifying gaps, unanswered questions, and assumptions.
- Synthesizing findings without overstating what the sources support.
- Flagging when a claim cannot be verified from the attached context.

Formatting:
- Use structured output: headings, bullets, citations to note titles.
- Be precise about what comes from which note.
- Do not bring in outside knowledge unless explicitly asked.`,
		responseLength: 'detailed',
		enabled: true,
		isBuiltIn: true,
	},
];

/** Get a built-in profile by ID. */
export function getBuiltinProfile(id: string): AssistantProfile | undefined {
	return BUILTIN_PROFILES.find(p => p.id === id);
}

/** Check if a profile ID is built-in. */
export function isBuiltinProfile(id: string): boolean {
	return BUILTIN_PROFILE_IDS.includes(id as typeof BUILTIN_PROFILE_IDS[number]);
}

/** Default profile ID for new conversations. */
export const DEFAULT_PROFILE_ID = 'general';

/** Create a custom profile with a unique ID. */
export function createCustomProfile(data: {
	name: string;
	icon: string;
	instructions: string;
	providerId?: ProviderId;
	model?: string;
	responseLength?: ResponseLength;
	contextScope?: ContextScope;
}): AssistantProfile {
	const providerId: ProviderId | undefined = data.providerId;
	const model: string | undefined = data.model;
	const responseLength: ResponseLength | undefined = data.responseLength;
	const contextScope: ContextScope | undefined = data.contextScope;
	const profile: AssistantProfile = {
		id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		name: data.name.trim() || 'Custom',
		icon: data.icon.trim() || 'zap',
		instructions: data.instructions.trim(),
		providerId,
		model,
		responseLength,
		enabled: true,
		isBuiltIn: false,
		contextScope,
	};
	return profile;
}

/** The settings a conversation actually runs with, after profile overrides. */
export interface EffectiveSettings {
	providerId: ProviderId;
	model: string;
	responseLength: ResponseLength;
}

/**
 * Overlay a profile's optional overrides onto the global defaults.
 *
 * An unset (or blank) override falls through to the global value, so a
 * profile only changes what it explicitly pins. This is the single place
 * where that precedence is decided; callers must not re-derive it.
 */
export function resolveEffectiveSettings(
	profile: AssistantProfile | undefined,
	settings: Pick<ObsAideSettings, 'defaultProvider' | 'providers' | 'responseLength'>,
): EffectiveSettings {
	const providerId = profile?.providerId ?? settings.defaultProvider;
	const model = profile?.model?.trim() || settings.providers[providerId].model;
	const responseLength = profile?.responseLength ?? settings.responseLength;
	return { providerId, model, responseLength };
}

/** Profile registry for managing built-in and custom profiles. */
export class ProfileRegistry {
	constructor(
		private readonly getSettings: () => { profiles: AssistantProfile[]; activeProfileId?: string },
		private readonly saveSettings: () => Promise<void>,
	) {}

	/** All profiles (built-in + custom). */
	getAll(): AssistantProfile[] {
		const settings = this.getSettings();
		return [...BUILTIN_PROFILES, ...settings.profiles];
	}

	/** Get enabled profiles for the selector. */
	getEnabled(): AssistantProfile[] {
		return this.getAll().filter(p => p.enabled);
	}

	/** Get a profile by ID. */
	get(id: string): AssistantProfile | undefined {
		return this.getAll().find(p => p.id === id);
	}

	/** Get the active profile, falling back to default. */
	getActive(): AssistantProfile {
		const settings = this.getSettings();
		const activeId = settings.activeProfileId ?? DEFAULT_PROFILE_ID;
		return this.get(activeId) ?? getBuiltinProfile(DEFAULT_PROFILE_ID)!;
	}

	/** Set the active profile. */
	async setActive(id: string): Promise<void> {
		const profile = this.get(id);
		if (!profile || !profile.enabled) {
			throw new Error(`Profile "${id}" not found or disabled`);
		}
		const settings = this.getSettings();
		settings.activeProfileId = id;
		await this.saveSettings();
	}

	/** Add a custom profile. */
	async add(profile: AssistantProfile): Promise<void> {
		const settings = this.getSettings();
		settings.profiles.push(profile);
		await this.saveSettings();
	}

	/** Update a custom profile. */
	async update(id: string, updates: Partial<AssistantProfile>): Promise<void> {
		const settings = this.getSettings();
		const index = settings.profiles.findIndex(p => p.id === id);
		if (index === -1) throw new Error(`Profile "${id}" not found`);
		const profile = settings.profiles[index]!;
		if (profile.isBuiltIn) throw new Error('Cannot modify built-in profile');
		settings.profiles[index] = { ...profile, ...updates, id: profile.id, isBuiltIn: false };
		await this.saveSettings();
	}

	/** Delete a custom profile. */
	async delete(id: string): Promise<void> {
		const settings = this.getSettings();
		const index = settings.profiles.findIndex(p => p.id === id);
		if (index === -1) throw new Error(`Profile "${id}" not found`);
		const profile = settings.profiles[index]!;
		if (profile.isBuiltIn) throw new Error('Cannot delete built-in profile');
		settings.profiles.splice(index, 1);
		// If deleted profile was active, fall back to default
		if (settings.activeProfileId === id) {
			settings.activeProfileId = DEFAULT_PROFILE_ID;
		}
		await this.saveSettings();
	}

	/** Duplicate a built-in or custom profile as an editable custom one. */
	async duplicate(profileId: string): Promise<AssistantProfile> {
		const source = this.get(profileId);
		if (!source) throw new Error(`Profile "${profileId}" not found`);
		const custom = createCustomProfile({
			name: `${source.name} (copy)`,
			icon: source.icon,
			instructions: source.instructions,
			providerId: source.providerId,
			model: source.model,
			responseLength: source.responseLength,
			contextScope: source.contextScope,
		});
		await this.add(custom);
		return custom;
	}
}

/** Migrate old tutorModeByDefault setting to profile system. */
export function migrateTutorMode(
	settings: { tutorModeByDefault?: boolean; activeProfileId?: string },
): { activeProfileId?: string } {
	if (settings.tutorModeByDefault && !settings.activeProfileId) {
		return { activeProfileId: 'tutor' };
	}
	return {};
}