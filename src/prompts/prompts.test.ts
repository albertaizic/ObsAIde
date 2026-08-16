import { describe, expect, it } from 'vitest';
import { AIDE_ACTIONS } from '../actions/registry';
import { REWRITE_CONTRACT } from './actions';
import { buildSystemPrompt } from './system';

describe('buildSystemPrompt', () => {
	it('uses the tutor persona in tutor mode', () => {
		expect(buildSystemPrompt({ mode: 'chat' })).toContain('assistant built into');
		expect(buildSystemPrompt({ mode: 'tutor' })).toContain('patient tutor');
	});

	it('appends action and user instructions in that order', () => {
		const prompt = buildSystemPrompt({
			mode: 'chat',
			actionInstructions: 'ACTION RULES',
			customInstructions: 'USER RULES',
		});
		expect(prompt.indexOf('ACTION RULES')).toBeLessThan(prompt.indexOf('USER RULES'));
	});

	it('ignores blank instructions', () => {
		const prompt = buildSystemPrompt({
			mode: 'chat',
			customInstructions: '   ',
			actionInstructions: '',
		});
		expect(prompt).toBe(buildSystemPrompt({ mode: 'chat' }));
	});
});

describe('note actions', () => {
	it('uses unique, stable IDs', () => {
		const ids = AIDE_ACTIONS.map((action) => action.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('tells rewriting actions to return only Markdown', () => {
		for (const action of AIDE_ACTIONS.filter((candidate) => candidate.mutates)) {
			expect(action.build('do it').system).toContain(REWRITE_CONTRACT);
		}
	});

	it('never applies the rewrite contract to explanatory actions', () => {
		for (const action of AIDE_ACTIONS.filter((candidate) => !candidate.mutates)) {
			expect(action.build('').system).not.toContain(REWRITE_CONTRACT);
		}
	});

	it('carries the user instruction into the rewrite prompt', () => {
		const rewrite = AIDE_ACTIONS.find((action) => action.id === 'rewrite');
		expect(rewrite?.build('make it formal').user).toContain('make it formal');
	});
});
