import { TFile, type App } from 'obsidian';
import { listFolderNotes } from './collect';
import { applyContextLimits, formatContextBlock } from './format';
import type { Attachment, ContextRole, ResolvedAttachment } from './types';
import type { ContextLimits } from './types';

/**
 * Turn attachments into the text that will actually be sent.
 *
 * Notes are read one at a time, only when a request is being sent. There is no
 * indexing, no caching and no background scan of the vault. A folder expands
 * here into one entry per Markdown note it holds, so note boundaries survive
 * all the way into the prompt.
 */
export async function resolveAttachments(
	app: App,
	attachments: readonly Attachment[],
	limits: ContextLimits,
): Promise<ResolvedAttachment[]> {
	const resolved: ResolvedAttachment[] = [];

	for (const attachment of attachments) {
		const role: ContextRole = attachment.role ?? 'primary';

		if (attachment.kind === 'selection') {
			resolved.push({
				attachmentId: attachment.id,
				kind: 'selection',
				role,
				path: attachment.path,
				title: attachment.title,
				lines: attachment.lines,
				content: attachment.text ?? '',
				truncated: false,
			});
			continue;
		}

		if (attachment.kind === 'folder') {
			for (const file of listFolderNotes(app, attachment.path ?? '')) {
				resolved.push(await readNote(app, file, attachment.id, role, attachment.path));
			}
			continue;
		}

		const file = attachment.path ? app.vault.getAbstractFileByPath(attachment.path) : null;
		if (!(file instanceof TFile)) {
			resolved.push({
				attachmentId: attachment.id,
				kind: 'note',
				role,
				path: attachment.path,
				title: attachment.title,
				content: '',
				truncated: false,
				missing: true,
			});
			continue;
		}
		resolved.push(await readNote(app, file, attachment.id, role));
	}

	return applyContextLimits(resolved, limits);
}

async function readNote(
	app: App,
	file: TFile,
	attachmentId: string,
	role: ContextRole,
	folderPath?: string,
): Promise<ResolvedAttachment> {
	const base = {
		attachmentId,
		kind: 'note' as const,
		role,
		path: file.path,
		title: file.basename,
		folderPath,
	};
	try {
		return { ...base, content: await app.vault.cachedRead(file), truncated: false };
	} catch {
		return { ...base, content: '', truncated: false, missing: true };
	}
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
