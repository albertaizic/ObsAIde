import { TFile, type App } from 'obsidian';
import { applyContextLimits, formatContextBlock } from './format';
import type { Attachment, ContextLimits, ResolvedAttachment } from './types';

/**
 * Turn attachments into the text that will actually be sent.
 *
 * Notes are read one at a time, only when a request is being sent. There is no
 * indexing, no caching and no background scan of the vault.
 */
export async function resolveAttachments(
	app: App,
	attachments: readonly Attachment[],
	limits: ContextLimits,
): Promise<ResolvedAttachment[]> {
	const resolved: ResolvedAttachment[] = [];

	for (const attachment of attachments) {
		if (attachment.kind === 'selection') {
			resolved.push({
				attachment,
				content: attachment.text ?? '',
				truncated: false,
			});
			continue;
		}

		const file = attachment.path
			? app.vault.getAbstractFileByPath(attachment.path)
			: null;
		if (!(file instanceof TFile)) {
			resolved.push({ attachment, content: '', truncated: false, missing: true });
			continue;
		}

		try {
			const content = await app.vault.cachedRead(file);
			resolved.push({ attachment, content, truncated: false });
		} catch {
			resolved.push({ attachment, content: '', truncated: false, missing: true });
		}
	}

	return applyContextLimits(resolved, limits);
}

/** Convenience wrapper: resolve then render, in one step. */
export async function buildContextBlock(
	app: App,
	attachments: readonly Attachment[],
	limits: ContextLimits,
): Promise<{ block: string; parts: ResolvedAttachment[] }> {
	const parts = await resolveAttachments(app, attachments, limits);
	return { block: formatContextBlock(parts), parts };
}
