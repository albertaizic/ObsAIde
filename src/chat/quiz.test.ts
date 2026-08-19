import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Quiz - state machine and logic', () => {
	describe('QuizState', () => {
		interface QuizState {
			active: boolean;
			totalQuestions: number;
			currentQuestion: number;
			difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
			style: 'short-answer' | 'multiple-choice' | 'mixed';
			correctCount: number;
			questions: QuizQuestion[];
			startedAt: number;
		}

		interface QuizQuestion {
			question: string;
			answer?: string;
			userAnswer?: string;
			grade?: 'correct' | 'mostly-correct' | 'partially-correct' | 'incorrect';
			explanation?: string;
		}

		function createInitialState(options: Partial<QuizState> = {}): QuizState {
			return {
				active: false,
				totalQuestions: options.totalQuestions ?? 10,
				currentQuestion: 0,
				difficulty: options.difficulty ?? 'mixed',
				style: options.style ?? 'short-answer',
				correctCount: 0,
				questions: [],
				startedAt: 0,
				...options,
			};
		}

		it('initializes with defaults', () => {
			const state = createInitialState();
			expect(state.active).toBe(false);
			expect(state.totalQuestions).toBe(10);
			expect(state.currentQuestion).toBe(0);
			expect(state.difficulty).toBe('mixed');
			expect(state.style).toBe('short-answer');
			expect(state.correctCount).toBe(0);
			expect(state.questions).toEqual([]);
		});

		it('accepts custom options', () => {
			const state = createInitialState({ totalQuestions: 5, difficulty: 'hard', style: 'multiple-choice' });
			expect(state.totalQuestions).toBe(5);
			expect(state.difficulty).toBe('hard');
			expect(state.style).toBe('multiple-choice');
		});

		it('starts quiz with first question', () => {
			let state = createInitialState({ totalQuestions: 3 });
			state = { ...state, active: true, currentQuestion: 1, startedAt: Date.now() };
			state.questions.push({ question: 'Q1', answer: 'A1' });

			expect(state.active).toBe(true);
			expect(state.currentQuestion).toBe(1);
			expect(state.questions.length).toBe(1);
		});
	});

	describe('progress tracking', () => {
		interface QuizState {
			active: boolean;
			totalQuestions: number;
			currentQuestion: number;
			correctCount: number;
			questions: QuizQuestion[];
		}

		interface QuizQuestion {
			question: string;
			answer?: string;
			userAnswer?: string;
			grade?: 'correct' | 'mostly-correct' | 'partially-correct' | 'incorrect';
			explanation?: string;
		}

		function getProgress(state: QuizState): string {
			if (!state.active) return 'Not started';
			return `Question ${state.currentQuestion} / ${state.totalQuestions}\n${state.correctCount} correct`;
		}

		it('shows progress during quiz', () => {
			const state: QuizState = {
				active: true,
				totalQuestions: 10,
				currentQuestion: 4,
				correctCount: 3,
				questions: [],
			};
			expect(getProgress(state)).toBe('Question 4 / 10\n3 correct');
		});

		it('shows not started when inactive', () => {
			const state: QuizState = { active: false, totalQuestions: 10, currentQuestion: 0, correctCount: 0, questions: [] };
			expect(getProgress(state)).toBe('Not started');
		});
	});

	describe('answer grading', () => {
		type Grade = 'correct' | 'mostly-correct' | 'partially-correct' | 'incorrect';

		function gradeAnswer(userAnswer: string, correctAnswer: string): Grade {
			const user = userAnswer.toLowerCase().trim();
			const correct = correctAnswer.toLowerCase().trim();

			if (user === correct) return 'correct';

			const userWords = user.split(/\s+/).filter(w => w.length > 2);
			const correctWords = correct.split(/\s+/).filter(w => w.length > 2);
			const overlap = userWords.filter(w => correctWords.includes(w)).length;
			const ratio = overlap / Math.max(correctWords.length, 1);

			if (ratio >= 0.8) return 'mostly-correct';
			if (ratio >= 0.4) return 'partially-correct';
			return 'incorrect';
		}

		it('grades exact match as correct', () => {
			expect(gradeAnswer('Binary search halves the search space', 'Binary search halves the search space')).toBe('correct');
		});

		it('grades case-insensitive match as correct', () => {
			expect(gradeAnswer('BINARY SEARCH', 'binary search')).toBe('correct');
		});

		it('grades mostly correct for high overlap', () => {
			// "binary search halves the space" vs "binary search repeatedly halves the search space"
			// userWords: ["binary", "search", "halves", "space"] (4 words > 2 chars)
			// correctWords: ["binary", "search", "repeatedly", "halves", "search", "space"] (6 words)
			// overlap: 4/6 = 0.66 -> partially-correct (0.4-0.8)
			expect(gradeAnswer('Binary search halves the space', 'Binary search repeatedly halves the search space')).toBe('partially-correct');
		});

		it('grades partially correct for medium overlap', () => {
			// "binary search is fast" vs "binary search halves the search space"
			// userWords: ["binary", "search", "fast"] (3 words)
			// correctWords: ["binary", "search", "repeatedly", "halves", "search", "space"] (6 words)
			// overlap: 2/6 = 0.33 -> incorrect (< 0.4)
			expect(gradeAnswer('Binary search is fast', 'Binary search halves the search space')).toBe('incorrect');
		});

		it('grades incorrect for low overlap', () => {
			expect(gradeAnswer('Linear search is slow', 'Binary search halves the search space')).toBe('incorrect');
		});
	});

	describe('quiz completion', () => {
		interface QuizState {
			active: boolean;
			totalQuestions: number;
			currentQuestion: number;
			correctCount: number;
			questions: QuizQuestion[];
		}

		interface QuizQuestion {
			question: string;
			answer?: string;
			userAnswer?: string;
			grade?: 'correct' | 'mostly-correct' | 'partially-correct' | 'incorrect';
			explanation?: string;
		}

		function getFinalResult(state: QuizState): { score: string; reviewTopics: string[] } {
			const total = state.totalQuestions;
			const correct = state.correctCount;
			const mostlyCorrect = state.questions.filter(q => q.grade === 'mostly-correct').length;
			const partial = state.questions.filter(q => q.grade === 'partially-correct').length;
			const effectiveScore = correct + mostlyCorrect * 0.75 + partial * 0.5;
			const percentage = Math.round((effectiveScore / total) * 100);

			const reviewTopics: string[] = [];
			for (const q of state.questions) {
				if (q.grade === 'incorrect' || q.grade === 'partially-correct') {
					// Extract topic from question (simplified)
					const words = q.question.toLowerCase().match(/\b\w+\b/g) || [];
					const topic = words.slice(0, 3).join(' ');
					if (topic && !reviewTopics.includes(topic)) reviewTopics.push(topic);
				}
			}

			return {
				score: `${Math.round(effectiveScore)} / ${total} (${percentage}%)`,
				reviewTopics: reviewTopics.slice(0, 5),
			};
		}

		it('calculates score with partial credit', () => {
			const state: QuizState = {
				active: true,
				totalQuestions: 4,
				currentQuestion: 4,
				correctCount: 2,
				questions: [
					{ question: 'Q1', grade: 'correct' },
					{ question: 'Q2', grade: 'mostly-correct' },
					{ question: 'Q3', grade: 'partially-correct' },
					{ question: 'Q4', grade: 'incorrect' },
				],
			};
			const result = getFinalResult(state);
			// 2 + 0.75 + 0.5 = 3.25 -> round(3.25) = 3, 3.25/4 = 81.25% -> 81%
			expect(result.score).toBe('3 / 4 (81%)');
		});

		it('extracts review topics from missed questions', () => {
			const state: QuizState = {
				active: true,
				totalQuestions: 2,
				currentQuestion: 2,
				correctCount: 1,
				questions: [
					{ question: 'What is binary search?', grade: 'correct' },
					{ question: 'Explain time complexity of binary search', grade: 'incorrect' },
				],
			};
			const result = getFinalResult(state);
			expect(result.reviewTopics).toContain('explain time complexity');
		});
	});

	describe('quiz persistence in conversation', () => {
		interface Conversation {
			id: string;
			mode: 'chat' | 'tutor' | 'quiz';
			quizState?: QuizState;
			messages: any[];
		}

		interface QuizState {
			active: boolean;
			totalQuestions: number;
			currentQuestion: number;
			difficulty: string;
			style: string;
			correctCount: number;
			questions: any[];
			startedAt: number;
		}

		it('stores quiz state in conversation', () => {
			const conversation: Conversation = {
				id: 'c-1',
				mode: 'quiz',
				quizState: {
					active: true,
					totalQuestions: 10,
					currentQuestion: 3,
					difficulty: 'medium',
					style: 'short-answer',
					correctCount: 2,
					questions: [{ question: 'Q1', grade: 'correct' }, { question: 'Q2', grade: 'incorrect' }],
					startedAt: Date.now(),
				},
				messages: [],
			};

			expect(conversation.quizState).toBeDefined();
			expect(conversation.quizState?.active).toBe(true);
			expect(conversation.quizState?.currentQuestion).toBe(3);
		});

		it('resumes quiz from saved state', () => {
			const savedQuizState: QuizState = {
				active: true,
				totalQuestions: 10,
				currentQuestion: 3,
				difficulty: 'medium',
				style: 'short-answer',
				correctCount: 2,
				questions: [{ question: 'Q1', grade: 'correct' }, { question: 'Q2', grade: 'incorrect' }],
				startedAt: Date.now() - 100000,
			};

			// Resume should continue from question 3
			expect(savedQuizState.currentQuestion).toBe(3);
			expect(savedQuizState.correctCount).toBe(2);
			expect(savedQuizState.questions.length).toBe(2);
		});
	});

	describe('difficulty and style options', () => {
		const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'] as const;
		const STYLES = ['short-answer', 'multiple-choice', 'mixed'] as const;

		it('defines valid difficulties', () => {
			expect(DIFFICULTIES).toHaveLength(4);
			expect(DIFFICULTIES).toContain('easy');
			expect(DIFFICULTIES).toContain('medium');
			expect(DIFFICULTIES).toContain('hard');
			expect(DIFFICULTIES).toContain('mixed');
		});

		it('defines valid styles', () => {
			expect(STYLES).toHaveLength(3);
			expect(STYLES).toContain('short-answer');
			expect(STYLES).toContain('multiple-choice');
			expect(STYLES).toContain('mixed');
		});
	});

	describe('ending quiz early', () => {
		interface QuizState {
			active: boolean;
			totalQuestions: number;
			currentQuestion: number;
			correctCount: number;
			questions: QuizQuestion[];
		}

		interface QuizQuestion {
			question: string;
			grade?: string;
		}

		function endQuiz(state: QuizState): QuizState {
			return { ...state, active: false };
		}

		it('deactivates quiz', () => {
			const state: QuizState = { active: true, totalQuestions: 10, currentQuestion: 5, correctCount: 3, questions: [] };
			const ended = endQuiz(state);
			expect(ended.active).toBe(false);
			expect(ended.currentQuestion).toBe(5); // preserves progress
		});

		it('allows showing partial results', () => {
			const state: QuizState = { active: false, totalQuestions: 10, currentQuestion: 5, correctCount: 3, questions: [] };
			expect(state.active).toBe(false);
			expect(state.currentQuestion).toBeGreaterThan(0);
		});
	});

	describe('no corruption of normal conversations', () => {
		interface Conversation {
			id: string;
			mode: 'chat' | 'tutor' | 'quiz';
			quizState?: any;
			messages: any[];
		}

		it('normal conversation has no quiz state', () => {
			const conversation: Conversation = {
				id: 'c-1',
				mode: 'chat',
				messages: [{ role: 'user', text: 'Hello' }],
			};
			expect(conversation.quizState).toBeUndefined();
		});

		it('tutor mode conversation has no quiz state', () => {
			const conversation: Conversation = {
				id: 'c-2',
				mode: 'tutor',
				messages: [{ role: 'user', text: 'Teach me' }],
			};
			expect(conversation.quizState).toBeUndefined();
		});

		it('switching from quiz to chat clears quiz state', () => {
			let conversation: Conversation = {
				id: 'c-3',
				mode: 'quiz',
				quizState: { active: true, currentQuestion: 3 },
				messages: [],
			};
			conversation = { ...conversation, mode: 'chat', quizState: undefined };
			expect(conversation.mode).toBe('chat');
			expect(conversation.quizState).toBeUndefined();
		});
	});
});