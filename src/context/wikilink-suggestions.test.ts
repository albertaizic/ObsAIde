import { describe, expect, it } from 'vitest';
import {
	applyWikilink,
	canAnalyzeWikilinks,
	discoverCandidates,
	filterExistingLinks,
	generateSuggestions,
	isPositionProtected,
	isProposalAlreadyLinked,
	parseWikilinkProposals,
	planSourceReads,
	type WikilinkCandidate,
} from './wikilink-suggestions';

/** The App parameter of discoverCandidates, without importing 'obsidian'. */
type FakeApp = Parameters<typeof discoverCandidates>[0];

interface FakeFile {
	path: string;
	basename: string;
}

function makeApp(files: FakeFile[], contents: Record<string, string>): FakeApp {
	return {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: async (file: FakeFile) => {
				const content = contents[file.path];
				if (content === undefined) throw new Error('unreadable');
				return content;
			},
		},
	} as unknown as FakeApp;
}

function candidate(title: string, extras: Partial<WikilinkCandidate> = {}): WikilinkCandidate {
	return { path: `notes/${title}.md`, title, aliases: [], headings: [], ...extras };
}

describe('discoverCandidates', () => {
	it('extracts frontmatter aliases and headings from candidate notes', async () => {
		const app = makeApp(
			[
				{ path: 'notes/Machine Learning.md', basename: 'Machine Learning' },
				{ path: 'notes/Zettelkasten.md', basename: 'Zettelkasten' },
			],
			{
				'notes/Machine Learning.md':
					'---\naliases: [ML, Deep Learning]\n---\n# Overview\n\n## Training Models\n',
				'notes/Zettelkasten.md': '---\naliases: Slip Box\n---\n',
			},
		);

		const candidates = await discoverCandidates(app, 'machine learning slip box overview');

		const ml = candidates.find((c) => c.title === 'Machine Learning');
		expect(ml?.path).toBe('notes/Machine Learning.md');
		expect(ml?.aliases).toEqual(['ML', 'Deep Learning']);
		expect(ml?.headings).toEqual(['Overview', 'Training Models']);
		expect(candidates.find((c) => c.title === 'Zettelkasten')?.aliases).toEqual(['Slip Box']);
	});

	it('surfaces notes whose alias overlaps even when the title does not', async () => {
		const app = makeApp(
			[{ path: 'notes/Zettelkasten.md', basename: 'Zettelkasten' }],
			{ 'notes/Zettelkasten.md': '---\naliases: [Slip Box]\n---\n' },
		);

		const candidates = await discoverCandidates(app, 'the slip box method');

		expect(candidates.map((c) => c.title)).toEqual(['Zettelkasten']);
	});

	it('surfaces notes whose heading overlaps the source text', async () => {
		const app = makeApp(
			[{ path: 'notes/Archive.md', basename: 'Archive' }],
			{ 'notes/Archive.md': '# Spaced Repetition Schedule\n' },
		);

		const candidates = await discoverCandidates(app, 'repetition schedule notes');

		expect(candidates.map((c) => c.title)).toEqual(['Archive']);
	});

	it('ranks exact-ish title matches above partial ones', async () => {
		const app = makeApp(
			[
				{ path: 'notes/Learning.md', basename: 'Learning' },
				{ path: 'notes/Machine Learning Basics.md', basename: 'Machine Learning Basics' },
			],
			{ 'notes/Learning.md': '', 'notes/Machine Learning Basics.md': '' },
		);

		const candidates = await discoverCandidates(app, 'machine learning basics intro');

		expect(candidates.map((c) => c.title)).toEqual(['Machine Learning Basics', 'Learning']);
	});

	it('respects maxCandidates', async () => {
		const files: FakeFile[] = [
			{ path: 'notes/Alpha Topic.md', basename: 'Alpha Topic' },
			{ path: 'notes/Beta Topic.md', basename: 'Beta Topic' },
			{ path: 'notes/Gamma Topic.md', basename: 'Gamma Topic' },
		];
		const contents = Object.fromEntries(files.map((f) => [f.path, '']));
		const candidates = await discoverCandidates(makeApp(files, contents), 'topic notes', {
			maxCandidates: 2,
		});

		expect(candidates).toHaveLength(2);
		for (const c of candidates) {
			expect(['Alpha Topic', 'Beta Topic', 'Gamma Topic']).toContain(c.title);
		}
	});

	it('skips files it cannot read', async () => {
		const app = makeApp(
			[
				{ path: 'notes/Alpha Topic.md', basename: 'Alpha Topic' },
				{ path: 'notes/Broken Note.md', basename: 'Broken Note' },
			],
			{ 'notes/Alpha Topic.md': '' },
		);

		const candidates = await discoverCandidates(app, 'alpha topic');

		expect(candidates.map((c) => c.title)).toEqual(['Alpha Topic']);
	});

	it('drops candidates with no textual overlap with the source', async () => {
		const app = makeApp(
			[{ path: 'notes/Totally Different.md', basename: 'Totally Different' }],
			{ 'notes/Totally Different.md': '' },
		);

		const candidates = await discoverCandidates(app, 'unrelated gibberish words');

		expect(candidates).toEqual([]);
	});

	it('treats a source of only short words as matching every note (empty phrase quirk)', async () => {
		const files: FakeFile[] = [
			{ path: 'notes/Alpha.md', basename: 'Alpha' },
			{ path: 'notes/Beta.md', basename: 'Beta' },
		];
		const contents = Object.fromEntries(files.map((f) => [f.path, '']));

		const candidates = await discoverCandidates(makeApp(files, contents), 'ab cd');

		// With no words longer than two chars the phrase check runs against ''
		// and `includes('')` is true for every title, scoring each note 20.
		expect(candidates).toHaveLength(2);
	});
});

describe('generateSuggestions', () => {
	it('suggests the full title at high confidence and prefers it over a shorter alias', () => {
		const suggestions = generateSuggestions('we studied machine learning and ml', [
			candidate('Machine Learning', { aliases: ['ML'] }),
		]);

		expect(suggestions).toEqual([
			{
				targetPath: 'notes/Machine Learning.md',
				targetTitle: 'Machine Learning',
				sourcePhrase: 'Machine Learning',
				confidence: 0.9,
				reason: 'Matches "Machine Learning" in source text',
			},
		]);
	});

	it('falls back to an alias at medium-high confidence when the title is absent', () => {
		const suggestions = generateSuggestions('the slip box method', [
			candidate('Zettelkasten', { aliases: ['Slip Box'] }),
		]);

		expect(suggestions).toEqual([
			{
				targetPath: 'notes/Zettelkasten.md',
				targetTitle: 'Zettelkasten',
				sourcePhrase: 'slip box',
				confidence: 0.85,
				reason: 'Matches "slip box" in source text',
			},
		]);
	});

	it('falls back to the longest matching word at low confidence', () => {
		const suggestions = generateSuggestions('quantum entanglement explained simply', [
			candidate('Quantum Entanglement Theory'),
		]);

		expect(suggestions[0].sourcePhrase).toBe('entanglement');
		expect(suggestions[0].confidence).toBe(0.6);
	});

	it('produces nothing when only short words or unrelated notes are involved', () => {
		const suggestions = generateSuggestions('add foo bar', [
			candidate('Addendum Notes'),
			candidate('Unrelated Note'),
		]);

		expect(suggestions).toEqual([]);
	});

	it('caps the number of suggestions at maxSuggestions', () => {
		const suggestions = generateSuggestions(
			'alpha beta gamma',
			[candidate('Alpha'), candidate('Beta'), candidate('Gamma')],
			2,
		);

		expect(suggestions).toHaveLength(2);
	});

	it('orders suggestions by descending confidence', () => {
		const suggestions = generateSuggestions(
			'studied machine learning and the entanglement chapter',
			[candidate('Quantum Entanglement'), candidate('Machine Learning')],
		);

		expect(suggestions.map((s) => s.targetTitle)).toEqual(['Machine Learning', 'Quantum Entanglement']);
		expect(suggestions.map((s) => s.confidence)).toEqual([0.9, 0.6]);
	});
});

describe('filterExistingLinks', () => {
	it('removes candidates already linked by title, including piped targets and other casing', () => {
		const kept = filterExistingLinks(
			[candidate('Machine Learning'), candidate('Zettelkasten'), candidate('Archive')],
			'see [[Machine Learning]] and [[zettelkasten|my notes]] here',
		);

		expect(kept.map((c) => c.title)).toEqual(['Archive']);
	});

	it('keeps candidates whose title only appears as display text of another link', () => {
		const kept = filterExistingLinks(
			[candidate('Machine Learning'), candidate('Zettelkasten')],
			'see [[Zettelkasten|Machine Learning]] here',
		);

		expect(kept.map((c) => c.title)).toEqual(['Machine Learning']);
	});
});

describe('isPositionProtected', () => {
	it('flags positions inside a fenced code block but not after it closes', () => {
		const fenced = 'before\n```\nquantum realm\n```';
		expect(isPositionProtected(fenced, fenced.indexOf('quantum'))).toBe(true);
		const after = '```\ncode\n```\nplain text';
		expect(isPositionProtected(after, after.indexOf('plain'))).toBe(false);
	});

	it('flags positions inside inline code but not outside it', () => {
		const text = 'run `npm test` now';
		expect(isPositionProtected(text, text.indexOf('npm'))).toBe(true);
		expect(isPositionProtected(text, text.indexOf('now'))).toBe(false);
	});

	it('flags positions inside the frontmatter region but not in the body', () => {
		const text = '---\ntitle: Test\n---\nBody text';
		expect(isPositionProtected(text, text.indexOf('title'))).toBe(true);
		expect(isPositionProtected(text, text.indexOf('Body'))).toBe(false);
	});

	it('flags positions inside an existing wikilink but not after it', () => {
		const text = 'see [[Note Name]] here';
		expect(isPositionProtected(text, text.indexOf('Note'))).toBe(true);
		expect(isPositionProtected(text, text.indexOf('here'))).toBe(false);
	});

	it('flags positions inside a markdown link but not past its end', () => {
		const text = 'check [the docs](https://example.com) out';
		expect(isPositionProtected(text, text.indexOf('the docs'))).toBe(true);
		expect(isPositionProtected(text, text.indexOf('out'))).toBe(false);
	});
});

describe('applyWikilink', () => {
	it('wraps the first case-insensitive occurrence in a simple link when the phrase matches the title', () => {
		const result = applyWikilink(
			'Quantum realm is vast. quantum realm again.',
			'quantum realm',
			'Quantum Realm',
		);

		expect(result).toBe('[[Quantum Realm]] is vast. quantum realm again.');
	});

	it('uses a piped link when the phrase differs from the title', () => {
		const result = applyWikilink('the quantum realm is vast', 'quantum realm', 'Quantum Mechanics');

		expect(result).toBe('the [[Quantum Mechanics|quantum realm]] is vast');
	});

	it('leaves the text unchanged when the first occurrence sits in a protected position', () => {
		const text = 'before\n```\nquantum realm\n```';

		expect(applyWikilink(text, 'quantum realm', 'Quantum Realm')).toBe(text);
	});

	it('leaves the text unchanged when the phrase is absent', () => {
		expect(applyWikilink('nothing to see', 'quantum realm', 'Quantum Realm')).toBe('nothing to see');
	});
});

describe('parseWikilinkProposals', () => {
	it('parses a plain JSON reply keeping every confidence tier', () => {
		const response = JSON.stringify({
			suggestions: [
				{
					targetPhrase: 'spaced repetition',
					linkTarget: 'Spaced Repetition',
					replacement: 'study [[Spaced Repetition]] daily',
					reason: 'core concept',
					confidence: 'high',
				},
				{
					targetPhrase: 'active recall',
					linkTarget: 'Active Recall',
					replacement: 'practice [[Active Recall]]',
					reason: 'technique',
					confidence: 'medium',
				},
				{
					targetPhrase: 'interleaving',
					linkTarget: 'Interleaving',
					replacement: 'mix topics',
					reason: 'strategy',
					confidence: 'low',
				},
			],
		});

		expect(parseWikilinkProposals(response)).toEqual([
			{
				targetPhrase: 'spaced repetition',
				linkTarget: 'Spaced Repetition',
				replacement: 'study [[Spaced Repetition]] daily',
				reason: 'core concept',
				confidence: 'high',
			},
			{
				targetPhrase: 'active recall',
				linkTarget: 'Active Recall',
				replacement: 'practice [[Active Recall]]',
				reason: 'technique',
				confidence: 'medium',
			},
			{
				targetPhrase: 'interleaving',
				linkTarget: 'Interleaving',
				replacement: 'mix topics',
				reason: 'strategy',
				confidence: 'low',
			},
		]);
	});

	it('parses a reply wrapped in a code fence', () => {
		const proposal = {
			targetPhrase: 'a phrase',
			linkTarget: 'A Note',
			replacement: 'see [[A Note]] now',
			reason: 'related',
			confidence: 'medium',
		};
		const response = '```json\n' + JSON.stringify({ suggestions: [proposal] }) + '\n```';

		expect(parseWikilinkProposals(response)).toEqual([proposal]);
	});

	it('drops entries that fail any field type check or carry an unknown confidence', () => {
		const response = JSON.stringify({
			suggestions: [
				{
					targetPhrase: 'a phrase',
					linkTarget: 'A',
					replacement: '[[A]]',
					reason: 'r',
					confidence: 'medium',
				},
				{ targetPhrase: 'b phrase', linkTarget: 'B', replacement: '[[B]]', confidence: 'low' },
				{ targetPhrase: 'c phrase', linkTarget: 'C', replacement: '[[C]]', reason: 'r', confidence: 'urgent' },
				{ targetPhrase: 3, linkTarget: 'D', replacement: '[[D]]', reason: 'r', confidence: 'low' },
				'just a string',
				null,
			],
		});

		expect(parseWikilinkProposals(response)).toEqual([
			{
				targetPhrase: 'a phrase',
				linkTarget: 'A',
				replacement: '[[A]]',
				reason: 'r',
				confidence: 'medium',
			},
		]);
	});

	it('returns an empty list on malformed JSON or a missing suggestions array', () => {
		expect(parseWikilinkProposals('this is not json')).toEqual([]);
		expect(parseWikilinkProposals(JSON.stringify({ nope: [] }))).toEqual([]);
		expect(parseWikilinkProposals(JSON.stringify({ suggestions: 'everything' }))).toEqual([]);
	});
});

describe('isProposalAlreadyLinked', () => {
	it('is true exactly when the replacement contains both brackets', () => {
		expect(isProposalAlreadyLinked({ replacement: 'study [[Spaced Repetition]] daily' })).toBe(true);
		expect(isProposalAlreadyLinked({ replacement: 'plain sentence' })).toBe(false);
		expect(isProposalAlreadyLinked({ replacement: 'half [ open' })).toBe(false);
		expect(isProposalAlreadyLinked({ replacement: 'half ] close' })).toBe(false);
	});
});

describe('canAnalyzeWikilinks', () => {
	const base = { sourceNoteCount: 0, sourceFolderCount: 0 };

	it('enables on a target plus a single source note — no folder required', () => {
		expect(canAnalyzeWikilinks({ ...base, targetCount: 1, sourceNoteCount: 1 })).toBe(true);
		expect(canAnalyzeWikilinks({ ...base, targetCount: 1, sourceNoteCount: 3 })).toBe(true);
	});

	it('enables on folder or vault-root sources', () => {
		expect(canAnalyzeWikilinks({ ...base, targetCount: 1, sourceFolderCount: 1 })).toBe(true);
	});

	it('disables without a target, without any source, and while analyzing', () => {
		expect(canAnalyzeWikilinks({ ...base, targetCount: 0, sourceNoteCount: 2 })).toBe(false);
		expect(canAnalyzeWikilinks({ ...base, targetCount: 1, sourceNoteCount: 0 })).toBe(false);
		expect(
			canAnalyzeWikilinks({ targetCount: 1, sourceNoteCount: 2, sourceFolderCount: 1 }, true),
		).toBe(false);
	});
});

describe('planSourceReads', () => {
	it('deduplicates notes picked directly and via folders', () => {
		const plan = planSourceReads({
			sourceNotePaths: ['a.md', 'b.md'],
			folderNotePaths: ['b.md', 'c.md', 'a.md'],
			targetPaths: [],
			maxTotalChars: 1000,
			sizeOf: () => 10,
		});
		expect(plan.paths).toEqual(['a.md', 'b.md', 'c.md']);
		expect(plan.totalChars).toBe(30);
	});

	it('excludes targets from the source payload — their content travels as the target', () => {
		const plan = planSourceReads({
			sourceNotePaths: ['target.md', 'source.md'],
			folderNotePaths: ['target.md', 'other.md'],
			targetPaths: ['target.md'],
			maxTotalChars: 1000,
			sizeOf: () => 10,
		});
		expect(plan.paths).toEqual(['source.md', 'other.md']);
	});

	it('applies the context budget before any read happens, via metadata sizes', () => {
		const sizes: Record<string, number> = { small1: 10, small2: 10, big: 100, small3: 10 };
		const plan = planSourceReads({
			sourceNotePaths: ['small1', 'big', 'small2', 'small3'],
			folderNotePaths: [],
			targetPaths: [],
			maxTotalChars: 30,
			sizeOf: path => sizes[path] ?? 0,
		});
		// The oversized note is skipped so smaller later notes can still fit.
		expect(plan.paths).toEqual(['small1', 'small2', 'small3']);
		expect(plan.totalChars).toBe(30);
		expect(plan.omittedCount).toBe(1);
	});

	it('is deterministic: same inputs produce the same plan', () => {
		const make = () => planSourceReads({
			sourceNotePaths: ['x.md', 'y.md'],
			folderNotePaths: ['y.md'],
			targetPaths: [],
			maxTotalChars: 50,
			sizeOf: () => 5,
		});
		expect(make()).toEqual(make());
	});
});
