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

/** Human-readable type names the renderer owns — never the model's wording. */
export const QUIZ_TYPE_LABELS: Record<QuizQuestionType, string> = {
	'short-answer': 'Short Answer',
	'multiple-choice': 'Multiple Choice',
	'true-false': 'True / False',
	'explain': 'Explain / Reasoning',
	'application': 'Application / Scenario',
};

/**
 * A leading choice marker some models add despite instructions:
 * "A.", "A)", "(A)", "A:", "A -". The renderer letters options itself, so a
 * marker that survives here would come out doubled ("A. A. Binary search").
 *
 * Requires an explicit separator, so plain text that merely starts with
 * "A" or "B" is untouched.
 */
const CHOICE_MARKER = /^\s*\(\s*[A-Da-d]\s*\)\s*|^\s*[A-Da-d]\s*[.)\]:]\s*|^\s*[A-Da-d]\s+[-–—]\s+/;

/** Strip one obvious leading A–D choice marker from an option's text. */
export function stripChoiceMarker(option: string): string {
	return option.replace(CHOICE_MARKER, '').trim();
}

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
			if (!question.options.every(option => typeof option === 'string')) {
				return { valid: false, error: `Question ${i + 1} (multiple-choice) options must be text` };
			}
			if (
				typeof question.correctIndex !== 'number' ||
				!Number.isInteger(question.correctIndex) ||
				question.correctIndex < 0 ||
				question.correctIndex > 3
			) {
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

/** Keep multi-line content inside the callout: every line needs its own "> ". */
function calloutLine(text: string): string {
	return text.split('\n').join('\n> ');
}

/**
 * Render a validated quiz as study Markdown: one heading per problem —
 * labelled with its type, so mixed quizzes are checkable at a glance — with
 * lettered options for multiple choice and collapsible answer callouts.
 *
 * Choice letters are added here and only here; incoming option text is
 * stripped of any model-supplied marker first so prefixes can never double up.
 */
export function renderQuizMarkdown(
	data: { questions: QuizQuestion[] },
	includeAnswers: boolean,
): string {
	const letters = ['A', 'B', 'C', 'D'];
	let markdown = '';
	for (let i = 0; i < data.questions.length; i++) {
		const q = data.questions[i];
		if (!q) continue;

		const typeLabel = QUIZ_TYPE_LABELS[q.type] ?? q.type;
		markdown += `## Problem ${i + 1} (${typeLabel})\n`;
		markdown += `**${q.question}**\n\n`;

		if (q.type === 'multiple-choice' && Array.isArray(q.options)) {
			const cleaned = q.options.map(stripChoiceMarker);
			for (let j = 0; j < cleaned.length; j++) {
				markdown += `- ${letters[j]}. ${cleaned[j]}\n`;
			}
			markdown += '\n';
		}

		if (includeAnswers) {
			markdown += `> [!answer]- ✅ Answer\n`;
			if (q.type === 'multiple-choice' && Array.isArray(q.options) && typeof q.correctIndex === 'number') {
				const correct = stripChoiceMarker(q.options[q.correctIndex] ?? '');
				markdown += `> **${letters[q.correctIndex]}. ${calloutLine(correct)}**\n`;
			} else if (typeof q.answer === 'string') {
				markdown += `> ${calloutLine(q.answer)}\n`;
			}
			if (q.explanation) {
				markdown += `> ${calloutLine(q.explanation)}\n`;
			}
			markdown += '\n';
		}

		markdown += '\n';
	}
	return markdown;
}
