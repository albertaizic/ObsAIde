import { Notice, TFile, type App } from 'obsidian';
import {
	applyWikilink,
	isPositionProtected,
	isProposalAlreadyLinked,
	parseWikilinkProposals,
	type WikilinkProposal,
} from '../context/wikilink-suggestions';
import type ObsAidePlugin from '../main';
import { buildWikilinkSystemPrompt, buildWikilinkUserPrompt } from '../prompts/wikilinks';
import {
	WikilinkSetupModal,
	type WikilinkFolderSource,
	type WikilinkSetupOptions,
} from './wikilink-setup-modal';
import { EditPreviewModal } from './edit-preview';

/**
 * The "Suggest wikilinks" workflow: pick targets and sources in a modal, run
 * one provider request per target, parse the structured proposals and hand the
 * resulting rewrite to the diff-review modal — nothing touches the note until
 * the user accepts the change there.
 */
export class WikilinkFlow {
	constructor(
		private readonly app: App,
		private readonly plugin: ObsAidePlugin,
	) {}

	async open(): Promise<void> {
		// Get the active file as default target
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('Open a Markdown note to suggest wikilinks.');
			return;
		}

		// Open the setup modal to select targets and sources
		new WikilinkSetupModal(this.app, (options, signal) => {
			void this.runAnalysis(options, signal);
		}).open();
	}

	private async runAnalysis(options: WikilinkSetupOptions, signal: AbortSignal): Promise<void> {
		const selectedTargets = options.targets;

		if (selectedTargets.length === 0) {
			new Notice('Select at least one target note.');
			return;
		}

		const hasSources = options.sources.length > 0 || options.sourceFolders.length > 0;
		if (!hasSources) {
			new Notice('Select at least one source note or folder.');
			return;
		}

		// Collect all source files
		const sourceFiles: TFile[] = [];
		for (const source of options.sources) {
			sourceFiles.push(source.file);
		}
		for (const folder of options.sourceFolders) {
			const isRoot = (folder as WikilinkFolderSource & { isRoot?: boolean }).isRoot === true;
			if (isRoot) {
				// Vault root - add all markdown files
				const notes = this.app.vault.getMarkdownFiles();
				sourceFiles.push(...notes);
			} else {
				// folder.folder is guaranteed non-null here because isRoot is false
				const folderRef = folder.folder;
				if (folderRef) {
					const notes = this.app.vault.getMarkdownFiles().filter(f =>
						f.path.startsWith(folderRef.path + '/') || f.path === folderRef.path
					);
					sourceFiles.push(...notes);
				}
			}
		}

		// Remove duplicates
		const uniqueSourceFiles = Array.from(new Map(sourceFiles.map(f => [f.path, f])).values());

		if (uniqueSourceFiles.length === 0) {
			new Notice('No readable source content found.');
			return;
		}

		// For each target, run analysis
		for (const target of selectedTargets) {
			if (signal.aborted) return;
			await this.analyzeTarget(target.file, uniqueSourceFiles, signal);
		}
	}

	private async analyzeTarget(targetFile: TFile, sourceFiles: TFile[], signal: AbortSignal): Promise<void> {
		// Read target content
		const targetContent = await this.app.vault.cachedRead(targetFile);
		if (!targetContent.trim()) {
			new Notice(`Target note "${targetFile.basename}" is empty.`);
			return;
		}

		// Read source contents (with budget limits)
		const settings = this.plugin.chat.getSettings();
		const sourceContents: Array<{ path: string; content: string }> = [];
		let totalChars = 0;
		const maxSourceChars = Math.min(settings.maxContextChars, 50000); // Cap for wikilink analysis

		for (const sourceFile of sourceFiles) {
			if (totalChars >= maxSourceChars) break;
			try {
				const content = await this.app.vault.cachedRead(sourceFile);
				const remaining = maxSourceChars - totalChars;
				const truncated = content.length > remaining ? content.slice(0, remaining) : content;
				if (truncated.trim()) {
					sourceContents.push({ path: sourceFile.path, content: truncated });
					totalChars += truncated.length;
				}
			} catch {
				// Skip unreadable files
			}
		}

		if (sourceContents.length === 0) {
			new Notice('No readable source content found.');
			return;
		}

		// Build the AI prompt for semantic wikilink analysis
		const systemPrompt = buildWikilinkSystemPrompt();
		const userPrompt = buildWikilinkUserPrompt(targetFile.path, targetContent, sourceContents);

		// Show loading
		new Notice('Analyzing connections…');

		try {
			const result = await this.plugin.providers.complete({
				providerId: this.plugin.chat.providerId,
				model: this.plugin.chat.model,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				signal,
			});

			// Parse structured suggestions from AI response
			const suggestions = parseWikilinkProposals(result.text);
			if (suggestions.length === 0) {
				new Notice('No useful wikilink connections found.');
				return;
			}

			// Filter out existing wikilinks in target
			const filtered = suggestions.filter(s => !isProposalAlreadyLinked(s));

			// Show review modal using existing diff infrastructure
			await this.showReview(targetFile, filtered);
		} catch (error) {
			new Notice('Wikilink analysis failed: ' + String(error));
		}
	}

	private async showReview(targetFile: TFile, suggestions: WikilinkProposal[]): Promise<void> {
		// Read current target content
		const targetContent = await this.app.vault.cachedRead(targetFile);

		// Apply all suggestions to create proposed text
		let proposedText = targetContent;
		for (const suggestion of suggestions) {
			if (suggestion.replacement) {
				const idx = proposedText.toLowerCase().indexOf(suggestion.targetPhrase.toLowerCase());
				if (idx !== -1 && !isPositionProtected(proposedText, idx)) {
					proposedText = proposedText.slice(0, idx) + suggestion.replacement + proposedText.slice(idx + suggestion.targetPhrase.length);
				}
			} else {
				proposedText = applyWikilink(proposedText, suggestion.targetPhrase, suggestion.linkTarget);
			}
		}

		// If no changes, notify and return
		if (proposedText === targetContent) {
			new Notice('No changes to apply.');
			return;
		}

		// Show review modal using existing EditPreviewModal infrastructure
		new EditPreviewModal(this.app, {
			proposedText,
			anchor: {
				path: targetFile.path,
				cursor: { line: 0, ch: 0 },
				selection: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text: targetContent },
			},
			replacesAnchor: true,
		}).open();
	}
}
