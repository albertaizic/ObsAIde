import { Notice, TFile, type App } from 'obsidian';
import {
	applyWikilink,
	isPositionProtected,
	isProposalAlreadyLinked,
	parseWikilinkProposals,
	planSourceReads,
	type WikilinkProposal,
} from '../context/wikilink-suggestions';
import { isInsideFolder, isMarkdownPath } from '../context/folder';
import type ObsAidePlugin from '../main';
import { buildWikilinkSystemPrompt, buildWikilinkUserPrompt } from '../prompts/wikilinks';
import {
	WikilinkSetupModal,
	type WikilinkSetupOptions,
	type WikilinkStage,
	type WikilinkTargetResult,
} from './wikilink-setup-modal';
import { EditPreviewModal } from './edit-preview';

/**
 * The "Suggest wikilinks" workflow.
 *
 * The setup modal drives the interaction; this class does the work behind it:
 * plan what to read (before reading anything), fetch only what is needed,
 * run one provider request per target while reporting real stages, and hand
 * per-target proposals back for the in-modal result view. Nothing touches a
 * note until the user accepts a diff in the review modal.
 */
export class WikilinkFlow {
	constructor(
		private readonly app: App,
		private readonly plugin: ObsAidePlugin,
	) {}

	async open(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('Open a Markdown note to suggest wikilinks.');
			return;
		}

		new WikilinkSetupModal(this.app, {
			analyze: (options, signal, onStage) => this.analyze(options, signal, onStage),
			onReview: (result) => this.showReview(result.targetFile, result.proposals),
		}).open();
	}

	private async analyze(
		options: WikilinkSetupOptions,
		signal: AbortSignal,
		onStage: (stage: WikilinkStage) => void,
	): Promise<WikilinkTargetResult[]> {
		const settings = this.plugin.chat.getSettings();
		const maxSourceChars = Math.min(settings.maxContextChars, 50000); // Cap for wikilink analysis

		// --- preparing ---------------------------------------------------------
		onStage('preparing');

		// One enumeration of the Markdown index; folders and the root expand
		// against it without extra vault walks.
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const fileByPath = new Map(markdownFiles.map(file => [file.path, file]));

		const folderNotePaths: string[] = [];
		for (const folder of options.sourceFolders) {
			if (folder.isRoot === true || !folder.folder) {
				folderNotePaths.push(...markdownFiles.map(file => file.path));
				continue;
			}
			folderNotePaths.push(
				...markdownFiles
					.filter(file => isInsideFolder(file.path, folder.folder!.path))
					.map(file => file.path),
			);
		}

		// Decide what to read BEFORE reading: dedupe, drop targets, apply budget
		// using file sizes from metadata only.
		const plan = planSourceReads({
			sourceNotePaths: options.sources.map(source => source.file.path),
			folderNotePaths: folderNotePaths.filter(path => isMarkdownPath(path)),
			targetPaths: options.targets.map(target => target.file.path),
			maxTotalChars: maxSourceChars,
			sizeOf: path => fileByPath.get(path)?.stat.size ?? 0,
		});

		// Read only the planned notes; independent reads run concurrently.
		const contentByPath = new Map<string, string>();
		await Promise.all(
			plan.paths.map(async path => {
				const file = fileByPath.get(path);
				if (!file) return;
				try {
					contentByPath.set(path, await this.app.vault.cachedRead(file));
				} catch {
					// Skip unreadable files
				}
			}),
		);
		if (signal.aborted) return [];

		// --- analyzing ----------------------------------------------------------
		onStage('analyzing');

		const results: WikilinkTargetResult[] = [];
		for (const target of options.targets) {
			if (signal.aborted) return results;
			results.push(await this.analyzeTarget(target.file, contentByPath, signal));
		}
		return results;
	}

	private async analyzeTarget(
		targetFile: TFile,
		contentByPath: Map<string, string>,
		signal: AbortSignal,
	): Promise<WikilinkTargetResult> {
		const targetContent = await this.app.vault.cachedRead(targetFile);

		const empty = (reason?: string): WikilinkTargetResult => {
			if (reason && !signal.aborted) new Notice(reason);
			return { targetFile, proposals: [] };
		};

		if (!targetContent.trim()) return empty(`Target note "${targetFile.basename}" is empty.`);

		// Sources for this target: everything planned except the target itself
		// (its content travels in the prompt as the target), minus entries that
		// turned out unreadable or empty on read.
		const sourceContents = [...contentByPath.entries()]
			.filter(([path, content]) => path !== targetFile.path && content.trim())
			.map(([path, content]) => ({ path, content }));

		if (sourceContents.length === 0) return empty('No readable source content found.');

		const systemPrompt = buildWikilinkSystemPrompt();
		const userPrompt = buildWikilinkUserPrompt(targetFile.path, targetContent, sourceContents);

		try {
			const result = await this.plugin.providers.complete({
				providerId: this.plugin.chat.providerId,
				model: this.plugin.chat.model,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				signal,
			});
			if (signal.aborted) return { targetFile, proposals: [] };

			const suggestions = parseWikilinkProposals(result.text);
			const filtered = suggestions.filter(s => !isProposalAlreadyLinked(s));
			return { targetFile, proposals: filtered };
		} catch (error) {
			if (signal.aborted || (error as Error).name === 'AbortError') {
				return { targetFile, proposals: [] };
			}
			throw error;
		}
	}

	/** Build the full proposed text and open the existing diff review. */
	private showReview(targetFile: TFile, proposals: WikilinkProposal[]): void {
		void (async () => {
			const targetContent = await this.app.vault.cachedRead(targetFile);

			let proposedText = targetContent;
			for (const suggestion of proposals) {
				if (suggestion.replacement) {
					const idx = proposedText.toLowerCase().indexOf(suggestion.targetPhrase.toLowerCase());
					if (idx !== -1 && !isPositionProtected(proposedText, idx)) {
						proposedText = proposedText.slice(0, idx) + suggestion.replacement + proposedText.slice(idx + suggestion.targetPhrase.length);
					}
				} else {
					proposedText = applyWikilink(proposedText, suggestion.targetPhrase, suggestion.linkTarget);
				}
			}

			if (proposedText === targetContent) {
				new Notice('No changes to apply.');
				return;
			}

			new EditPreviewModal(this.app, {
				proposedText,
				anchor: {
					path: targetFile.path,
					cursor: { line: 0, ch: 0 },
					selection: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text: targetContent },
				},
				replacesAnchor: true,
			}).open();
		})();
	}
}
