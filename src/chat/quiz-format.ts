import { stripCodeFence } from '../utils/text';

/** Kinds of quiz question the generator can produce. */
export type QuizQuestionType =
	| 'short-answer'
	| 'multiple-choice'
	| 'true-false'
	| 'explain'
	| 'application';

/** What the user asked for; `mixed` lets the model distribute across types. */
export type QuizTypeSelection = QuizQuestionType | 'mixed';

/** Question in structured quiz data returned by the model. */
export interface QuizQuestion {
	type: QuizQuestionType;
	question: string;
	options?: string[];
	correctIndex?: number;
	answer?: string;
	explanation?: string;
}

const QUESTION_TYPES: readonly QuizQuestionType[] = [
	'short-answer',
	'multiple-choice',
	'true-false',
	'explain',
	'application',
];

/**
 * Parse the model's quiz payload, tolerating surrounding prose or code fences.
 * Returns null when the response carries no questions array at all.
 */
export function parseQuizJson(text: string): { questions: QuizQuestion[] } | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
		const parsed: { questions?: unknown } = JSON.parse(stripCodeFence(text));
		if (!parsed.questions || !Array.isArray(parsed.questions)) {
			return null;
		}
		return { questions: parsed.questions as QuizQuestion[] };
	} catch {
		return null;
	}
}

/**
 * Enforce the structural contract of a generated quiz: one entry per requested
 * question, valid per-question shape, answers present when the user asked for
 * them, and enough variety when the selection was "mixed".
 */
export function validateQuizData(
	data: { questions: unknown[] },
	expectedCount: number,
	type: QuizTypeSelection,
	includeAnswers: boolean,
): { valid: boolean; error?: string } {
	const questions = data.questions;
	if (!Array.isArray(questions)) {
		return { valid: false, error: 'Missing or invalid questions array' };
	}
	if (questions.length !== expectedCount) {
		return { valid: false, error: `Expected ${expectedCount} questions, got ${questions.length}` };
	}

	// For mixed type, check distribution
	if (type === 'mixed') {
		const typeCounts = new Map<string, number>();
		for (let i = 0; i < questions.length; i++) {
			const q = questions[i];
			if (q && typeof q === 'object' && q !== null && 'type' in q && typeof q.type === 'string') {
				const typeValue = (q as { type: string }).type;
				if (typeValue) {
					typeCounts.set(typeValue, (typeCounts.get(typeValue) || 0) + 1);
				}
			}
		}
		const typesPresent = Array.from(typeCounts.keys()).filter(t => (typeCounts.get(t) || 0) > 0);
		if (typesPresent.length < Math.min(3, expectedCount)) {
			return { valid: false, error: 'Mixed type should include variety of question types' };
		}
	}

	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		if (!q || typeof q !== 'object' || q === null) {
			return { valid: false, error: `Question ${i + 1} is not an object` };
		}

		// Use type assertion after validation
		const question = q as Record<string, unknown>;

		// Check required fields
		if (typeof question.question !== 'string' || !question.question.trim()) {
			return { valid: false, error: `Question ${i + 1} missing question text` };
		}

		if (typeof question.type !== 'string' || !QUESTION_TYPES.includes(question.type as QuizQuestionType)) {
			return { valid: false, error: `Question ${i + 1} has invalid type` };
		}

		// Type-specific validation
		if (question.type === 'multiple-choice') {
			if (!Array.isArray(question.options) || question.options.length !== 4) {
				return { valid: false, error: `Question ${i + 1} (multiple-choice) must have exactly 4 options` };
			}
			if (typeof question.correctIndex !== 'number' || question.correctIndex < 0 || question.correctIndex > 3) {
				return { valid: false, error: `Question ${i + 1} (multiple-choice) must have correctIndex 0-3` };
			}
		}

		if (includeAnswers) {
			if (typeof question.answer !== 'string' || !question.answer.trim()) {
				return { valid: false, error: `Question ${i + 1} missing answer` };
			}
			if (typeof question.explanation !== 'string' || !question.explanation.trim()) {
				return { valid: false, error: `Question ${i + 1} missing explanation` };
			}
		}
	}

	return { valid: true };
}

/**
 * Render a validated quiz as study Markdown: one heading per problem,
 * lettered options for multiple choice, collapsible answer callouts.
 */
export function renderQuizMarkdown(
	data: { questions: QuizQuestion[] },
	includeAnswers: boolean,
): string {
	let markdown = '';
	for (let i = 0; i < data.questions.length; i++) {
		const q = data.questions[i];
		if (!q) continue;

		markdown += `## Problem ${i + 1}\n`;
		markdown += `**${q.question}**\n\n`;

		if (q.type === 'multiple-choice' && Array.isArray(q.options)) {
			const letters = ['A', 'B', 'C', 'D'];
			for (let j = 0; j < q.options.length; j++) {
				markdown += `- ${letters[j]}. ${q.options[j]}\n`;
			}
			markdown += '\n';
		}

		if (includeAnswers) {
			markdown += `> [!answer]- ✅ Answer\n`;
			if (q.type === 'multiple-choice' && Array.isArray(q.options) && typeof q.correctIndex === 'number') {
				const letters = ['A', 'B', 'C', 'D'];
				markdown += `> **${letters[q.correctIndex]}. ${q.options[q.correctIndex]}**\n`;
			} else {
				markdown += `> ${q.answer}\n`;
			}
			if (q.explanation) {
				markdown += `> ${q.explanation}\n`;
			}
			markdown += '\n';
		}

		markdown += '\n';
	}
	return markdown;
}
