/**
 * Context is always something the user attached on purpose.
 *
 * ObsAIde never reads the vault in the background: an attachment is created
 * only by an explicit action (choosing a note or folder, invoking Ask Aide on a
 * selection, running a note action) and is visible in the composer before the
 * request is sent.
 */
export type AttachmentKind = 'selection' | 'note' | 'folder';

/**
 * How the model should weight a piece of context.
 *
 * A selection the user asked about is `primary`; the note it came from is
 * `supporting` — there to resolve pronouns and shorthand, not to be summarised.
 */
export type ContextRole = 'primary' | 'supporting';

export interface Attachment {
	id: string;
	kind: AttachmentKind;
	/** Vault path of the note, folder, or the note a selection came from. */
	path?: string;
	/** Label shown on the chip. */
	title: string;
	/**
	 * Captured text. Selections are snapshotted at capture time because the
	 * editor moves on; notes and folders are re-read from the vault when the
	 * request is sent, so the model always sees the current file.
	 */
	text?: string;
	/** 1-based inclusive line range for a selection. */
	lines?: { from: number; to: number };
	role?: ContextRole;
	/** Markdown notes a folder held when it was attached, for the chip label. */
	noteCount?: number;
}

/**
 * One note-sized piece of context, ready to be rendered into the prompt.
 *
 * A folder attachment expands into one of these per Markdown note it contains,
 * so note boundaries stay explicit all the way to the provider.
 */
export interface ResolvedAttachment {
	/** The chip this came from, so removing a folder removes all its notes. */
	attachmentId: string;
	kind: 'selection' | 'note';
	role: ContextRole;
	/** Vault path, absent only for a selection made in an unsaved buffer. */
	path?: string;
	title: string;
	lines?: { from: number; to: number };
	/** Set when this note arrived as part of an attached folder. */
	folderPath?: string;
	content: string;
	truncated: boolean;
	/** The note could not be read, e.g. it was deleted or renamed. */
	missing?: boolean;
	/** Dropped entirely because the request budget was already spent. */
	omitted?: boolean;
}

export interface ContextLimits {
	maxCharsPerNote: number;
	maxContextChars: number;
}
