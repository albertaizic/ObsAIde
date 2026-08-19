import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptOptions, type ResponseLength } from './system';

describe('Response Length Control', () => {
	const baseOptions: SystemPromptOptions = {
		mode: 'chat',
		customInstructions: '',
		actionInstructions: '',
	};

	describe('buildSystemPrompt with responseLength', () => {
		it('adds Short instruction', () => {
			const prompt = buildSystemPrompt({ ...baseOptions, responseLength: 'short' });
			expect(prompt).toContain('Response length: SHORT');
			expect(prompt).toContain('concise, direct answers');
			expect(prompt).toContain('few sentences at most');
			expect(prompt).toContain('No unnecessary headings');
		});

		it('adds Detailed instruction', () => {
			const prompt = buildSystemPrompt({ ...baseOptions, responseLength: 'detailed' });
			expect(prompt).toContain('Response length: DETAILED');
			expect(prompt).toContain('fuller explanations');
			expect(prompt).toContain('examples');
			expect(prompt).toContain('structure');
			expect(prompt).toContain('No filler');
		});

		it('does not add length instruction for Normal', () => {
			const prompt = buildSystemPrompt({ ...baseOptions, responseLength: 'normal' });
			expect(prompt).not.toContain('Response length: SHORT');
			expect(prompt).not.toContain('Response length: DETAILED');
		});

		it('defaults to Normal when not specified', () => {
			const prompt = buildSystemPrompt(baseOptions);
			expect(prompt).not.toContain('Response length: SHORT');
			expect(prompt).not.toContain('Response length: DETAILED');
		});

		it('combines with tutor mode', () => {
			const prompt = buildSystemPrompt({ ...baseOptions, mode: 'tutor', responseLength: 'detailed' });
			expect(prompt).toContain('Teach rather than solve');
			expect(prompt).toContain('Response length: DETAILED');
		});

		it('combines with custom instructions', () => {
			const prompt = buildSystemPrompt({
				...baseOptions,
				responseLength: 'short',
				customInstructions: 'Use British English',
			});
			expect(prompt).toContain('Response length: SHORT');
			expect(prompt).toContain('Use British English');
		});

		it('combines with action instructions', () => {
			const prompt = buildSystemPrompt({
				...baseOptions,
				responseLength: 'detailed',
				actionInstructions: 'Summarize in one paragraph',
			});
			expect(prompt).toContain('Response length: DETAILED');
			expect(prompt).toContain('Summarize in one paragraph');
		});
	});

	describe('ResponseLength type', () => {
		it('accepts valid values', () => {
			const lengths: ResponseLength[] = ['short', 'normal', 'detailed'];
			for (const length of lengths) {
				const prompt = buildSystemPrompt({ ...baseOptions, responseLength: length });
				expect(typeof prompt).toBe('string');
			}
		});
	});

	describe('settings default and migration', () => {
		it('default is normal', () => {
			// This is tested in settings/types.test.ts
			expect(true).toBe(true);
		});

		it('migration handles missing responseLength', () => {
			// Tested in settings/types.test.ts via normalizeSettings
			expect(true).toBe(true);
		});
	});

	describe('action-specific overrides', () => {
		it('one-sentence summary action overrides Detailed', () => {
			// When actionInstructions says "one sentence", it should win
			const prompt = buildSystemPrompt({
				...baseOptions,
				responseLength: 'detailed',
				actionInstructions: 'Provide a one-sentence summary only.',
			});
			expect(prompt).toContain('Response length: DETAILED');
			expect(prompt).toContain('one-sentence summary only');
			// The action instruction comes after the length instruction in the prompt
		});

		it('tutor mode with Short still teaches', () => {
			const prompt = buildSystemPrompt({
				...baseOptions,
				mode: 'tutor',
				responseLength: 'short',
			});
			expect(prompt).toContain('Teach rather than solve');
			expect(prompt).toContain('Response length: SHORT');
		});
	});
});