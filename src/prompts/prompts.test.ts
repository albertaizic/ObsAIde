import { describe, expect, it } from 'vitest';
import { AIDE_ACTIONS } from '../actions/registry';
import { REWRITE_CONTRACT } from './actions';
import { buildSystemPrompt } from './system';

describe('buildSystemPrompt', () => {
	it('uses the tutor persona in tutor mode', () => {
		expect(buildSystemPrompt({ mode: 'chat' })).toContain('assistant built into');
		expect(buildSystemPrompt({ mode: 'tutor' })).toContain('patient tutor');
	});

	it('tells the default persona to be direct and skip filler', () => {
		const prompt = buildSystemPrompt({ mode: 'chat' });
		expect(prompt).toContain('Lead with the answer');
		expect(prompt).toContain('no restating the question');
		expect(prompt).toContain('Here is…');
		expect(prompt).toContain('Match length to the question');
		expect(prompt).toContain('No closing summary');
	});

	it('tells the default persona to return note content as the answer', () => {
		const prompt = buildSystemPrompt({ mode: 'chat' });
		expect(prompt).toContain('write, draft, continue, expand or add');
		expect(prompt).toContain('output the note content itself and nothing else');
		expect(prompt).toContain("Here's a paragraph you could add");
	});

	it('keeps tutor mode free to explain at length', () => {
		const tutor = buildSystemPrompt({ mode: 'tutor' });
		expect(tutor).toContain('Take the space you need');
		expect(tutor).not.toContain('Match length to the question');
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
