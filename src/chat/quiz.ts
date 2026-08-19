import type { Attachment } from '../context/types';

/** Quiz difficulty levels. */
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';

/** Quiz answer style. */
export type QuizStyle = 'short-answer' | 'multiple-choice' | 'mixed';

/** Grade for a user's answer. */
export type QuizGrade = 'correct' | 'mostly-correct' | 'partially-correct' | 'incorrect';

/** A single quiz question. */
export interface QuizQuestion {
	/** The question text. */
	question?: string;
	/** The correct answer (from the model). */
	answer?: string;
	/** The user's answer. */
	userAnswer?: string;
	/** The grade assigned. */
	grade?: QuizGrade;
	/** Explanation for the grade. */
	explanation?: string;
	/** Multiple choice options if applicable. */
	options?: string[];
}

/** Complete quiz state stored in the conversation. */
export interface QuizState {
	/** Whether a quiz is currently active. */
	active: boolean;
	/** Total number of questions in this quiz. */
	totalQuestions: number;
	/** Current question number (1-based). */
	currentQuestion: number;
	/** Difficulty setting. */
	difficulty: QuizDifficulty;
	/** Answer style. */
	style: QuizStyle;
	/** Number of correct answers so far. */
	correctCount: number;
	/** All questions in this quiz. */
	questions: QuizQuestion[];
	/** Timestamp when quiz started. */
	startedAt: number;
	/** Context attachments used for this quiz. */
	contextAttachments: Attachment[];
}

/** Default quiz state. */
export const DEFAULT_QUIZ_STATE: QuizState = {
	active: false,
	totalQuestions: 10,
	currentQuestion: 0,
	difficulty: 'mixed',
	style: 'short-answer',
	correctCount: 0,
	questions: [],
	startedAt: 0,
	contextAttachments: [],
};

/** Quiz setup options. */
export interface QuizSetupOptions {
	totalQuestions: number;
	difficulty: QuizDifficulty;
	style: QuizStyle;
}

/** Result of a completed quiz. */
export interface QuizResult {
	score: string;
	percentage: number;
	correctCount: number;
	totalQuestions: number;
	reviewTopics: string[];
	questions: QuizQuestion[];
}

/**
 * Build the system prompt for quiz mode.
 *
 * The quiz master generates questions grounded in the provided context,
 * evaluates answers fairly, and provides educational feedback.
 */
export function buildQuizSystemPrompt(
	contextBlock: string,
	setup: QuizSetupOptions,
): string {
	const difficultyInstruction = getDifficultyInstruction(setup.difficulty);
	const styleInstruction = getStyleInstruction(setup.style);

	return `You are a patient, encouraging quiz master helping the user study their Obsidian notes.

${difficultyInstruction}
${styleInstruction}

Context from the user's notes:
${contextBlock}

Rules:
- Generate ONE question at a time based ONLY on the provided context
- If the context doesn't contain the answer, say so and ask a different question
- Questions should test understanding, not just memorization
- Match the difficulty: ${setup.difficulty}
- Use ${setup.style} format
- After the user answers, evaluate and provide brief feedback
- Then ask the next question (or end if complete)
- Track progress: "Question N / M"
- At the end, show score and topics to review

Start by asking Question 1.`;
}

function getDifficultyInstruction(difficulty: QuizDifficulty): string {
	switch (difficulty) {
		case 'easy':
			return 'Difficulty: EASY. Ask foundational questions about definitions, key concepts, and basic relationships. Avoid edge cases.';
		case 'medium':
			return 'Difficulty: MEDIUM. Ask questions requiring explanation, application, or connecting concepts. Include some "why" and "how" questions.';
		case 'hard':
			return 'Difficulty: HARD. Ask questions requiring synthesis, analysis, or identifying subtle distinctions. Include edge cases and "what if" scenarios.';
		case 'mixed':
		default:
			return 'Difficulty: MIXED. Vary between easy, medium, and hard questions throughout the quiz.';
	}
}

function getStyleInstruction(style: QuizStyle): string {
	switch (style) {
		case 'short-answer':
			return 'Format: SHORT ANSWER. Ask open-ended questions. The user will type a brief answer.';
		case 'multiple-choice':
			return 'Format: MULTIPLE CHOICE. Provide 4 options (A, B, C, D) with the question. The user will select one.';
		case 'mixed':
		default:
			return 'Format: MIXED. Alternate between short answer and multiple choice questions.';
	}
}

/**
 * Build the user prompt for the next question.
 */
export function buildQuizUserPrompt(
	quizState: QuizState,
	setup: QuizSetupOptions,
): string {
	const progress = `Question ${quizState.currentQuestion} / ${setup.totalQuestions}`;
	const correctSoFar = `${quizState.correctCount} correct`;

	if (quizState.currentQuestion === 0) {
		return `${progress}\n${correctSoFar}\n\nLet's begin!`;
	}

	// This is called after user answered, so we show feedback and ask next
	const lastQuestion = quizState.questions[quizState.questions.length - 1];
	let prompt = `${progress}\n${correctSoFar}\n\n`;

	if (lastQuestion?.grade) {
		const gradeLabel = getGradeLabel(lastQuestion.grade);
		prompt += `**${gradeLabel}**\n`;
		if (lastQuestion.explanation) {
			prompt += `${lastQuestion.explanation}\n\n`;
		}
	}

	if (quizState.currentQuestion >= setup.totalQuestions) {
		prompt += '\nQuiz complete!';
		return prompt;
	}

	prompt += '\n**Next question:**';
	return prompt;
}

function getGradeLabel(grade: QuizGrade): string {
	switch (grade) {
		case 'correct':
			return '✓ Correct';
		case 'mostly-correct':
			return '✓ Mostly correct';
		case 'partially-correct':
			return '~ Partially correct';
		case 'incorrect':
			return '✗ Incorrect';
	}
}

/**
 * Grade the user's answer against the correct answer.
 *
 * Uses word overlap for a fair, context-grounded assessment.
 */
export function gradeAnswer(
	userAnswer: string,
	correctAnswer: string,
): { grade: QuizGrade; explanation: string } {
	const user = normalizeForGrading(userAnswer);
	const correct = normalizeForGrading(correctAnswer);

	if (user === correct) {
		return { grade: 'correct', explanation: 'Exactly right.' };
	}

	const userWords = user.split(/\s+/).filter(w => w.length > 2);
	const correctWords = correct.split(/\s+/).filter(w => w.length > 2);

	if (correctWords.length === 0) {
		return { grade: 'incorrect', explanation: 'No reference answer to compare against.' };
	}

	const overlap = userWords.filter(w => correctWords.includes(w)).length;
	const ratio = overlap / correctWords.length;

	if (ratio >= 0.75) {
		return {
			grade: 'mostly-correct',
			explanation: 'You got the key ideas. The main point is correct.',
		};
	}
	if (ratio >= 0.35) {
		return {
			grade: 'partially-correct',
			explanation: 'You have some of the right concepts, but missed key details.',
		};
	}
	return {
		grade: 'incorrect',
		explanation: `The expected answer was: ${correctAnswer}`,
	};
}

function normalizeForGrading(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Calculate final quiz result.
 */
export function calculateQuizResult(quizState: QuizState, setup: QuizSetupOptions): QuizResult {
	const total = setup.totalQuestions;
	let effectiveScore = 0;

	for (const q of quizState.questions) {
		switch (q.grade) {
			case 'correct':
				effectiveScore += 1;
				break;
			case 'mostly-correct':
				effectiveScore += 0.75;
				break;
			case 'partially-correct':
				effectiveScore += 0.5;
				break;
			case 'incorrect':
			default:
				break;
		}
	}

	const roundedScore = Math.round(effectiveScore);
	const percentage = Math.round((effectiveScore / total) * 100);

	// Extract review topics from incorrect/partially correct answers
	const reviewTopics: string[] = [];
	for (const q of quizState.questions) {
		if (q.grade === 'incorrect' || q.grade === 'partially-correct') {
			const topic = extractTopic(q.question ?? '');
			if (topic && !reviewTopics.includes(topic)) {
				reviewTopics.push(topic);
			}
		}
	}

	return {
		score: `${roundedScore} / ${total}`,
		percentage,
		correctCount: quizState.correctCount,
		totalQuestions: total,
		reviewTopics: reviewTopics.slice(0, 5),
		questions: quizState.questions,
	};
}

function extractTopic(question: string): string {
	// Simple extraction: first few meaningful words
	const words = question.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(w => w.length > 2 && !['what', 'how', 'why', 'when', 'where', 'which', 'explain', 'describe', 'define'].includes(w));
	return words.slice(0, 4).join(' ');
}

/**
 * Check if quiz is complete.
 */
export function isQuizComplete(quizState: QuizState, setup: QuizSetupOptions): boolean {
	return quizState.active && quizState.currentQuestion >= setup.totalQuestions;
}

/**
 * Get progress display string.
 */
export function getQuizProgress(quizState: QuizState, setup: QuizSetupOptions): string {
	if (!quizState.active) return 'Quiz not started';
	if (isQuizComplete(quizState, setup)) return 'Quiz complete';
	return `Question ${quizState.currentQuestion} / ${setup.totalQuestions}\n${quizState.correctCount} correct`;
}

/**
 * Start a new quiz.
 */
export function startQuiz(
	setup: QuizSetupOptions,
	attachments: Attachment[],
): QuizState {
	return {
		...DEFAULT_QUIZ_STATE,
		active: true,
		totalQuestions: setup.totalQuestions,
		difficulty: setup.difficulty,
		style: setup.style,
		startedAt: Date.now(),
		contextAttachments: attachments,
	};
}

/**
 * Advance to next question.
 */
export function advanceQuiz(quizState: QuizState): QuizState {
	return {
		...quizState,
		currentQuestion: quizState.currentQuestion + 1,
	};
}

/**
 * Record user's answer and grade it.
 */
export function recordAnswer(
	quizState: QuizState,
	questionIndex: number,
	userAnswer: string,
	correctAnswer: string,
): QuizState {
	const { grade, explanation } = gradeAnswer(userAnswer, correctAnswer);

	const updatedQuestions = [...quizState.questions];
	updatedQuestions[questionIndex] = {
		...updatedQuestions[questionIndex],
		userAnswer,
		grade,
		explanation,
	};

	let correctCount = quizState.correctCount;
	if (grade === 'correct' || grade === 'mostly-correct') {
		correctCount += 1;
	}

	return {
		...quizState,
		questions: updatedQuestions,
		correctCount,
	};
}

/**
 * End the quiz and return final state.
 */
export function endQuiz(quizState: QuizState): QuizState {
	return { ...quizState, active: false };
}

/**
 * Quiz mode system prompt to add to the base.
 */
export const QUIZ_SYSTEM_PROMPT_ADDITION = `You are running an interactive study quiz.

Quiz behavior:
- Ask ONE question at a time, wait for the user's answer
- Evaluate the answer fairly based on the provided context
- Give brief, encouraging feedback
- Then ask the next question
- Track and show progress: "Question N / M"
- At the end, show score and topics to review

Do NOT dump all questions at once. One question per turn.`;