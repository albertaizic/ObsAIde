import { describe, expect, it } from 'vitest';
import type { QuizQuestion } from './quiz-format';
import { parseQuizJson, renderQuizMarkdown, validateQuizData } from './quiz-format';
import {
	buildQuizUserPrompt,
	getDifficultyInstruction,
	getTypeInstruction,
} from '../prompts/quiz';

function shortAnswer(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
	return {
		type: 'short-answer',
		question: 'What is binary search?',
		answer: 'An algorithm that halves a sorted range each step.',
		explanation: 'Each comparison discards half of the remaining elements.',
		...overrides,
	};
}

function multipleChoice(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
	return {
		type: 'multiple-choice',
		question: 'What does binary search require?',
		options: ['Sorted input', 'Hash table', 'Linked list', 'Random access only'],
		correctIndex: 0,
		answer: 'Sorted input',
		explanation: 'Discarding half is only safe when the range is ordered.',
		...overrides,
	};
}

function trueFalse(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
	return {
		type: 'true-false',
		question: 'Binary search needs sorted input.',
		answer: 'True.',
		explanation: 'Ordering is what makes half-range discarding safe.',
		...overrides,
	};
}

describe('parseQuizJson', () => {
	const payload = JSON.stringify({
		questions: [{ type: 'short-answer', question: 'What is O(log n)?' }],
	});

	it('parses a plain JSON response', () => {
		const result = parseQuizJson(payload);
		expect(result).not.toBeNull();
		expect(result?.questions).toHaveLength(1);
		expect(result?.questions[0]?.question).toBe('What is O(log n)?');
	});

	it('parses a response wrapped in a ```json fence', () => {
		const result = parseQuizJson('```json\n' + payload + '\n```');
		expect(result?.questions).toHaveLength(1);
	});

	it('tolerates trailing prose after a closing fence', () => {
		const result = parseQuizJson('```json\n' + payload + '\n```\nHere is your quiz!');
		expect(result?.questions).toHaveLength(1);
	});

	it('returns null on non-JSON text', () => {
		expect(parseQuizJson('Sorry, I could not generate a quiz.')).toBeNull();
	});

	it('returns null when there is no questions array', () => {
		expect(parseQuizJson(JSON.stringify({ quiz: [] }))).toBeNull();
		expect(parseQuizJson(JSON.stringify({ questions: 3 }))).toBeNull();
	});

	it('returns null for bare JSON followed by prose', () => {
		// Without fences the parser cannot locate the payload, so prose breaks it.
		expect(parseQuizJson(payload + '\nEnjoy your quiz!')).toBeNull();
	});
});

describe('validateQuizData', () => {
	it('accepts a structurally valid quiz with answers', () => {
		const data = { questions: [shortAnswer(), multipleChoice()] };
		expect(validateQuizData(data, 2, 'mixed', true)).toEqual({ valid: true });
	});

	it('rejects a quiz whose count differs from the request', () => {
		const data = { questions: [shortAnswer(), shortAnswer()] };
		const result = validateQuizData(data, 5, 'short-answer', false);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Expected 5 questions, got 2');
	});

	it('rejects a question with empty or missing question text', () => {
		expect(validateQuizData({ questions: [shortAnswer({ question: '' })] }, 1, 'short-answer', false).error)
			.toBe('Question 1 missing question text');
		expect(validateQuizData({ questions: [shortAnswer({ question: '   ' })] }, 1, 'short-answer', false).error)
			.toBe('Question 1 missing question text');
	});

	it('rejects an unrecognized question type', () => {
		const data = { questions: [shortAnswer({ type: 'matching' })] };
		const result = validateQuizData(data, 1, 'short-answer', false);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Question 1 has invalid type');
	});

	it('requires exactly 4 options for multiple-choice', () => {
		const three = multipleChoice({ options: ['A. x', 'B. y', 'C. z'] });
		const five = multipleChoice({ options: ['A. w', 'B. x', 'C. y', 'D. z', 'E. v'] });
		expect(validateQuizData({ questions: [three] }, 1, 'multiple-choice', false).error)
			.toBe('Question 1 (multiple-choice) must have exactly 4 options');
		expect(validateQuizData({ questions: [five] }, 1, 'multiple-choice', false).error)
			.toBe('Question 1 (multiple-choice) must have exactly 4 options');
	});

	it('requires correctIndex within 0-3 for multiple-choice', () => {
		const low = multipleChoice({ correctIndex: -1 });
		const high = multipleChoice({ correctIndex: 4 });
		expect(validateQuizData({ questions: [low] }, 1, 'multiple-choice', false).error)
			.toBe('Question 1 (multiple-choice) must have correctIndex 0-3');
		expect(validateQuizData({ questions: [high] }, 1, 'multiple-choice', false).error)
			.toBe('Question 1 (multiple-choice) must have correctIndex 0-3');
	});

	it('requires answers when includeAnswers is true', () => {
		const noAnswer = shortAnswer({ answer: undefined });
		expect(validateQuizData({ questions: [noAnswer] }, 1, 'short-answer', true).error)
			.toBe('Question 1 missing answer');
	});

	it('requires explanations when includeAnswers is true', () => {
		const noExplanation = shortAnswer({ explanation: undefined });
		expect(validateQuizData({ questions: [noExplanation] }, 1, 'short-answer', true).error)
			.toBe('Question 1 missing explanation');
	});

	it('does not require answers when includeAnswers is false', () => {
		const bare = shortAnswer({ answer: undefined, explanation: undefined });
		expect(validateQuizData({ questions: [bare] }, 1, 'short-answer', false)).toEqual({ valid: true });
	});

	it('rejects a mixed quiz with fewer than 3 distinct types', () => {
		const data = {
			questions: [
				shortAnswer(),
				shortAnswer(),
				trueFalse(),
				trueFalse(),
			],
		};
		const result = validateQuizData(data, 4, 'mixed', false);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('variety');
	});

	it('accepts a valid mixed quiz spanning all five types', () => {
		const data = {
			questions: [
				shortAnswer(),
				multipleChoice(),
				trueFalse(),
				{ type: 'explain' as const, question: 'Why is binary search logarithmic?', answer: 'Halving steps.', explanation: 'log₂(n) halvings.' },
				{ type: 'application' as const, question: 'How many probes in 1024 items?', answer: 'Ten.', explanation: 'log₂(1024) = 10.' },
			],
		};
		expect(validateQuizData(data, 5, 'mixed', true)).toEqual({ valid: true });
	});
});

describe('renderQuizMarkdown', () => {
	it('renders one numbered heading with a bold question per problem', () => {
		const markdown = renderQuizMarkdown({ questions: [multipleChoice(), trueFalse()] }, false);
		expect(markdown).toContain('## Problem 1\n');
		expect(markdown).toContain('## Problem 2\n');
		expect(markdown).toContain('**What does binary search require?**');
		expect(markdown).toContain('**Binary search needs sorted input.**');
	});

	it('lists lettered A-D options for multiple-choice only', () => {
		const mc = renderQuizMarkdown({ questions: [multipleChoice()] }, false);
		expect(mc).toContain('- A. Sorted input\n');
		expect(mc).toContain('- B. Hash table\n');
		expect(mc).toContain('- C. Linked list\n');
		expect(mc).toContain('- D. Random access only\n');

		const tf = renderQuizMarkdown({ questions: [trueFalse()] }, false);
		expect(tf).not.toContain('- A.');
	});

	it('bolds the correct letter and option in the answer callout', () => {
		const markdown = renderQuizMarkdown(
			{ questions: [multipleChoice({ correctIndex: 1 })] },
			true,
		);
		expect(markdown).toContain('> [!answer]- ✅ Answer\n');
		expect(markdown).toContain('> **B. Hash table**\n');
	});

	it('renders non-multiple-choice answers as plain quoted text', () => {
		const markdown = renderQuizMarkdown({ questions: [trueFalse()] }, true);
		expect(markdown).toContain('> [!answer]- ✅ Answer\n');
		expect(markdown).toContain('> True.\n');
		expect(markdown).not.toContain('> **');
	});

	it('includes the explanation line when present', () => {
		const markdown = renderQuizMarkdown({ questions: [trueFalse()] }, true);
		expect(markdown).toContain('> Ordering is what makes half-range discarding safe.\n');
	});

	it('omits answers entirely when includeAnswers is false', () => {
		const markdown = renderQuizMarkdown({ questions: [multipleChoice(), trueFalse()] }, false);
		expect(markdown).not.toContain('[!answer]');
		expect(markdown).not.toContain('half-range discarding safe');
	});
});

describe('buildQuizUserPrompt', () => {
	const contextBlock = 'CONTEXT NOTES:\n- Binary search halves the search range each step.';
	const input = {
		contextBlock,
		questionCount: 5,
		type: 'multiple-choice' as const,
		difficulty: 'hard' as const,
		includeAnswerKey: true,
	};

	it('embeds the context block verbatim at the start', () => {
		const prompt = buildQuizUserPrompt(input);
		expect(prompt.startsWith(contextBlock)).toBe(true);
		expect(prompt).toContain(contextBlock);
	});

	it('states the exact question count and the strict JSON contract', () => {
		const prompt = buildQuizUserPrompt(input);
		expect(prompt).toContain('Output EXACTLY 5 questions');
		expect(prompt).toContain('strict JSON only, no code fences, no extra text');
		expect(prompt).toContain('"questions"');
		expect(prompt).toContain('Ground every question in the provided context');
	});

	it('embeds the type, difficulty, and answer-key instructions', () => {
		const withKey = buildQuizUserPrompt(input);
		expect(withKey).toContain(getTypeInstruction('multiple-choice'));
		expect(withKey).toContain(getDifficultyInstruction('hard'));
		expect(withKey).toContain('include an "answer" field');

		const withoutKey = buildQuizUserPrompt({ ...input, includeAnswerKey: false });
		expect(withoutKey).toContain('Set "answer" and "explanation" to null.');
		expect(withoutKey).not.toContain('include an "answer" field');
	});
});

describe('quiz prompt instruction fragments', () => {
	it('covers every difficulty branch', () => {
		expect(getDifficultyInstruction('easy')).toContain('foundational');
		expect(getDifficultyInstruction('medium')).toContain('application, or connecting concepts');
		expect(getDifficultyInstruction('hard')).toContain('synthesis, analysis');
		expect(getDifficultyInstruction('mixed')).toContain('vary between easy, medium, and hard');
	});

	it('covers every type branch', () => {
		expect(getTypeInstruction('short-answer')).toContain('Short answer — open-ended');
		expect(getTypeInstruction('multiple-choice')).toContain('labeled A, B, C, D');
		expect(getTypeInstruction('true-false')).toContain('True / False');
		expect(getTypeInstruction('explain')).toContain('"why" or "how"');
		expect(getTypeInstruction('application')).toContain('concrete scenario');
		expect(getTypeInstruction('mixed')).toContain('across all 5 types');
	});
});
