import type { QuizTypeSelection } from '../chat/quiz-format';

/** Difficulty spread requested for a generated quiz. */
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';

/** Prompt fragment describing the requested difficulty. */
export function getDifficultyInstruction(difficulty: QuizDifficulty): string {
	switch (difficulty) {
		case 'easy':
			return 'Difficulty: Easy — foundational questions about definitions and key concepts';
		case 'medium':
			return 'Difficulty: Medium — questions requiring explanation, application, or connecting concepts';
		case 'hard':
			return 'Difficulty: Hard — questions requiring synthesis, analysis, or identifying subtle distinctions';
		case 'mixed':
		default:
			return 'Difficulty: Mixed — vary between easy, medium, and hard questions';
	}
}

/** Prompt fragment describing the requested question format. */
export function getTypeInstruction(type: QuizTypeSelection): string {
	switch (type) {
		case 'short-answer':
			return 'Format: Short answer — open-ended questions';
		case 'multiple-choice':
			return 'Format: Multiple choice — each question MUST have 4 options labeled A, B, C, D as a Markdown list:\n- A. Option\n- B. Option\n- C. Option\n- D. Option';
		case 'true-false':
			return 'Format: True / False — each question is a statement that is either true or false. For false statements, explain the correction in the answer.';
		case 'explain':
			return 'Format: Explain / Reasoning — questions that test understanding of concepts, not just memorization. Ask "why" or "how".';
		case 'application':
			return 'Format: Application / Scenario — questions that require applying the supplied material to a concrete scenario or problem.';
		case 'mixed':
		default:
			return 'Format: Mixed — distribute questions across all 5 types: Short answer, Multiple choice, True/False, Explain/Reasoning, Application/Scenario. Distribute as evenly as possible.';
	}
}

export interface QuizPromptInput {
	contextBlock: string;
	questionCount: number;
	type: QuizTypeSelection;
	difficulty: QuizDifficulty;
	includeAnswerKey: boolean;
}

/**
 * The user prompt for quiz generation: the attached context plus strict
 * requirements and the JSON shape the parser expects back.
 */
export function buildQuizUserPrompt(input: QuizPromptInput): string {
	const difficultyInstruction = getDifficultyInstruction(input.difficulty);
	const typeInstruction = getTypeInstruction(input.type);
	const answerKeyInstruction = input.includeAnswerKey
		? 'For EACH question, include an "answer" field with the answer text and an "explanation" field with the reasoning.'
		: 'Do NOT include answers. Set "answer" and "explanation" to null.';

	return `${input.contextBlock}\n\nGenerate a study quiz based ONLY on the provided context.\n\nREQUIREMENTS:\n- Output EXACTLY ${input.questionCount} questions\n- Question types: ${typeInstruction}\n- ${difficultyInstruction}\n- ${answerKeyInstruction}\n- Ground every question in the provided context — do not invent material\n- If context is insufficient for a question, skip that topic but maintain numbering\n\nOUTPUT FORMAT (strict JSON only, no code fences, no extra text):\n{\n  "questions": [\n    {\n      "type": "short-answer|multiple-choice|true-false|explain|application",\n      "question": "Question text here?",\n      "options": ["Option text", "Option text", "Option text", "Option text"], // only for multiple-choice; option TEXT WITHOUT letter prefixes like "A." — letters are added later\n      "correctIndex": 0, // only for multiple-choice (0-3); index into options, not a letter\n      "answer": "Answer text", // when includeAnswerKey is true\n      "explanation": "Explanation text" // when includeAnswerKey is true\n    }\n  ]\n}\n\nFor multiple-choice questions, do NOT begin option text with "A.", "A)", "(A)" or similar markers.\nFor "mixed" type, distribute questions across types as evenly as possible (e.g., 5 questions = 1 of each type, 10 = 2 of each, etc.).`;
}
