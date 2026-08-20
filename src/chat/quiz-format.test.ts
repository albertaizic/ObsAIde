import { describe, it, expect } from 'vitest';

/**
 * Regex-based validation matching the logic in AideChatView.validateQuizFormat
 * Tests the exact format requirements for generated quiz notes.
 */

function validateQuizFormat(content: string, expectedCount: number, includeAnswers: boolean): { valid: boolean; error?: string } {
	// Check for code fences wrapping the whole content
	if (content.startsWith('```')) {
		return { valid: false, error: 'Response wrapped in code fence' };
	}

	// Count "## Problem N" headings
	const problemMatches = content.match(/^## Problem \d+/gm);
	const problemCount = problemMatches ? problemMatches.length : 0;
	if (problemCount !== expectedCount) {
		return { valid: false, error: `Expected ${expectedCount} problems, found ${problemCount}` };
	}

	// Check each problem has bold question text
	const boldQuestionMatches = content.match(/\*\*[^*]+\?\*\*/g);
	const boldQuestionCount = boldQuestionMatches ? boldQuestionMatches.length : 0;
	if (boldQuestionCount < expectedCount) {
		return { valid: false, error: 'Missing bold question text' };
	}

	// If answers enabled, check for answer callouts
	if (includeAnswers) {
		const answerCalloutMatches = content.match(/^> \[!answer\]- ✅ Answer/mg);
		const answerCount = answerCalloutMatches ? answerCalloutMatches.length : 0;
		if (answerCount !== expectedCount) {
			return { valid: false, error: `Expected ${expectedCount} answer callouts, found ${answerCount}` };
		}
	}

	// Check no separate Answer Key section
	if (content.includes('Answer Key') || content.includes('answer key') || content.includes('ANSWER KEY')) {
		return { valid: false, error: 'Contains separate Answer Key section' };
	}

	return { valid: true };
}

describe('Quiz format validation', () => {
	const validQuizWithAnswers = `# Binary Search Quiz

## Problem 1
**What is binary search?**

> [!answer]- ✅ Answer
> Binary search is an efficient algorithm for finding an item in a sorted array.

## Problem 2
**What is the time complexity?**

> [!answer]- ✅ Answer
> O(log n) because the search space is halved each iteration.`;

	const validQuizWithoutAnswers = `# Binary Search Quiz

## Problem 1
**What is binary search?**

## Problem 2
**What is the time complexity?**`;

	const quizWithMultipleChoice = `# Binary Search Quiz

## Problem 1
**Which of the following describes binary search?**

- A. Linear scan
- B. Divide and conquer
- C. Hash lookup
- D. Tree traversal

> [!answer]- ✅ Answer
> **B. Divide and conquer** — binary search halves the search space each step.`;

	it('accepts valid quiz with answers', () => {
		const result = validateQuizFormat(validQuizWithAnswers, 2, true);
		expect(result.valid).toBe(true);
	});

	it('accepts valid quiz without answers', () => {
		const result = validateQuizFormat(validQuizWithoutAnswers, 2, false);
		expect(result.valid).toBe(true);
	});

	it('accepts valid multiple choice quiz', () => {
		const result = validateQuizFormat(quizWithMultipleChoice, 1, true);
		expect(result.valid).toBe(true);
	});

	it('rejects quiz wrapped in code fence', () => {
		const fencedQuiz = '```markdown\n' + validQuizWithAnswers + '\n```';
		const result = validateQuizFormat(fencedQuiz, 2, true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('code fence');
	});

	it('rejects wrong problem count', () => {
		const result = validateQuizFormat(validQuizWithAnswers, 5, true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Expected 5 problems, found 2');
	});

	it('rejects missing bold question text', () => {
		const noBold = '# Quiz\n\n## Problem 1\nWhat is binary search?\n\n> [!answer]- ✅ Answer\n> Answer here.';
		const result = validateQuizFormat(noBold, 1, true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('bold question text');
	});

	it('rejects missing answer callouts when answers enabled', () => {
		const missingAnswers = '# Quiz\n\n## Problem 1\n**Question?**\n\n## Problem 2\n**Question?**';
		const result = validateQuizFormat(missingAnswers, 2, true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('answer callouts');
	});

	it('rejects separate Answer Key section', () => {
		const withAnswerKey = validQuizWithAnswers + '\n\n## Answer Key\n1. Answer';
		const result = validateQuizFormat(withAnswerKey, 2, true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Answer Key section');
	});

	it('rejects lowercase "answer key"', () => {
		const withAnswerKey = validQuizWithAnswers + '\n\n## answer key\n1. Answer';
		const result = validateQuizFormat(withAnswerKey, 2, true);
		expect(result.valid).toBe(false);
	});

	it('rejects uppercase "ANSWER KEY"', () => {
		const withAnswerKey = validQuizWithAnswers + '\n\n## ANSWER KEY\n1. Answer';
		const result = validateQuizFormat(withAnswerKey, 2, true);
		expect(result.valid).toBe(false);
	});
});

describe('Quiz format - edge cases', () => {
	it('handles extra whitespace', () => {
		const withWhitespace = '\n\n# Quiz\n\n## Problem 1\n**Question?**\n\n> [!answer]- ✅ Answer\n> Answer.\n\n';
		const result = validateQuizFormat(withWhitespace, 1, true);
		expect(result.valid).toBe(true);
	});

	it('requires exact answer callout format', () => {
		// Missing dash
		const wrongFormat = '# Quiz\n\n## Problem 1\n**Question?**\n\n> [!answer] ✅ Answer\n> Answer.';
		const result = validateQuizFormat(wrongFormat, 1, true);
		expect(result.valid).toBe(false);
	});

	it('handles case variations in Answer Key check', () => {
		// "Answer Key" (exact match) should be caught
		const exactMatch = '# Quiz\n\n## Problem 1\n**Question?**\n\n> [!answer]- ✅ Answer\n> Answer.\n\n## Answer Key\nShould not exist.';
		const result1 = validateQuizFormat(exactMatch, 1, true);
		expect(result1.valid).toBe(false);

		// "answer key" (lowercase) should be caught
		const lowercase = '# Quiz\n\n## Problem 1\n**Question?**\n\n> [!answer]- ✅ Answer\n> Answer.\n\n## answer key\nShould not exist.';
		const result2 = validateQuizFormat(lowercase, 1, true);
		expect(result2.valid).toBe(false);

		// "ANSWER KEY" (uppercase) should be caught
		const uppercase = '# Quiz\n\n## Problem 1\n**Question?**\n\n> [!answer]- ✅ Answer\n> Answer.\n\n## ANSWER KEY\nShould not exist.';
		const result3 = validateQuizFormat(uppercase, 1, true);
		expect(result3.valid).toBe(false);
	});
});