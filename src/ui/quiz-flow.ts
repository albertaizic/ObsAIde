import { Notice, TFolder, type App } from 'obsidian';
import { parseQuizJson, renderQuizMarkdown, validateQuizData } from '../chat/quiz-format';
import { buildContextBlock } from '../context/resolve';
import type { Attachment } from '../context/types';
import type ObsAidePlugin from '../main';
import { resolveEffectiveResponseLength } from '../settings/profiles';
import { buildQuizUserPrompt } from '../prompts/quiz';
import { buildSystemPrompt } from '../prompts/system';
import { sanitizeNoteName, uniqueNotePath } from '../utils/text';
import { QuizNoteModal, type QuizNoteOptions } from './quiz-note-modal';

/**
 * The "Create quiz note" workflow: configure it in a modal, run one provider
 * request over the attached context, validate the structured reply and write
 * the study note into the vault.
 */
export class QuizFlow {
	constructor(
		private readonly app: App,
		private readonly plugin: ObsAidePlugin,
	) {}

	/** Open the setup modal for the given context attachments. */
	open(attachments: Attachment[]): void {
		const modal = new QuizNoteModal(this.app, attachments, async (options, signal) => {
			const success = await this.generate(options, signal);
			if (success) {
				modal.close();
			} else if (!signal?.aborted) {
				// Re-enable the modal controls on failure (but not on abort)
				modal.setGenerationFailed();
			}
		});
		modal.open();
	}

	/**
	 * Generate a quiz note from the current context and create it as a Markdown file.
	 * Returns true on success, false on failure.
	 */
	private async generate(options: QuizNoteOptions, signal?: AbortSignal): Promise<boolean> {
		const settings = this.plugin.settings;
		const providerId = settings.defaultProvider;
		const model = settings.providers[providerId].model;

		// Build context block from attachments
		let contextBlock = '';
		if (options.attachments.length > 0) {
			const { block } = await buildContextBlock(this.plugin.app, options.attachments, {
				maxCharsPerNote: settings.maxCharsPerNote,
				maxContextChars: settings.maxContextChars,
			});
			contextBlock = block;
		}

		if (!contextBlock) {
			new Notice('No context available for quiz generation.');
			return false;
		}

		// Build the system prompt with the SAME effective length the UI shows —
		// a profile pin wins over the global preference here too.
		const activeProfile = this.plugin.profiles.getActive();
		const systemPrompt = buildSystemPrompt({
			mode: 'chat',
			customInstructions: settings.customInstructions,
			responseLength: resolveEffectiveResponseLength(activeProfile, settings),
			profileInstructions: activeProfile.instructions,
		});

		const userPrompt = buildQuizUserPrompt({
			contextBlock,
			questionCount: options.questionCount,
			type: options.type,
			difficulty: options.difficulty,
			includeAnswerKey: options.includeAnswerKey,
		});

		try {
			const result = await this.plugin.providers.complete({
				providerId,
				model,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				signal,
			});

			const rawText = result.text.trim();
			if (!rawText) {
				new Notice('Quiz generation returned empty content.');
				return false;
			}

			// Parse and validate structured quiz data
			const quizData = parseQuizJson(rawText);
			if (!quizData) {
				new Notice('Quiz generation failed: Invalid JSON structure returned.');
				return false;
			}

			const validation = validateQuizData(quizData, options.questionCount, options.type, options.includeAnswerKey);
			if (!validation.valid) {
				new Notice(`Quiz validation failed: ${validation.error}`);
				return false;
			}

			// Render Markdown from structured data
			const markdownContent = renderQuizMarkdown(quizData, options.includeAnswerKey);

			// Add frontmatter with title
			const frontmatter = `---\ncreated: ${new Date().toISOString().split('T')[0]}\nsource: ObsAIde\ntype: quiz\n---\n\n`;
			const titleLine = `# ${options.name}\n\n`;
			const fullContent = frontmatter + titleLine + markdownContent;

			// Create the note
			const folderPath = options.folderPath.trim();
			const resolvedFolder = folderPath
				? this.app.vault.getAbstractFileByPath(folderPath)
				: null;
			const folder = resolvedFolder instanceof TFolder ? resolvedFolder : this.app.vault.getRoot();

			const finalPath = uniqueNotePath(folder.path, sanitizeNoteName(options.name), (path) =>
				this.app.vault.getAbstractFileByPath(path) !== null,
			);

			const file = await this.app.vault.create(finalPath, fullContent);
			new Notice(`Created quiz: ${file.basename}`);
			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) await leaf.openFile(file);
			return true;
		} catch (error) {
			if (signal?.aborted || (error as Error).name === 'AbortError') {
				new Notice('Quiz generation cancelled.');
				return false;
			}
			new Notice('Quiz generation failed: ' + String(error));
			return false;
		}
	}
}
