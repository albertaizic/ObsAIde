import { describeNoteCount } from '../context/folder';
import type { Attachment } from '../context/types';

/**
 * How an attachment is presented, shared by the composer, the Ask Aide modal
 * and the transcript so the same context reads identically everywhere.
 */
export function attachmentIcon(kind: Attachment['kind']): string {
	if (kind === 'selection') return 'text-cursor-input';
	return kind === 'folder' ? 'folder' : 'file-text';
}

/** A folder chip stands for several notes, so it says how many. */
export function attachmentLabel(attachment: Attachment): string {
	if (attachment.kind === 'folder') {
		return `${attachment.title} — ${describeNoteCount(attachment.noteCount ?? 0)}`;
	}
	return attachment.title;
}
