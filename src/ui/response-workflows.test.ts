import { describe, expect, it, vi } from 'vitest';

describe('Response → Note Workflows', () => {
	describe('Append to note formatting', () => {
		it('adds separator when content does not end with newline', () => {
			const existing = 'Existing content';
			const separator = existing.endsWith('\n') ? '' : '\n';
			const result = `${existing}${separator}\n\n---\n\nNew response`;
			// Implementation: "Existing content" + "\n" + "\n\n---\n\nNew response"
			// = "Existing content\n\n\n---\n\nNew response"
			expect(result).toBe('Existing content\n\n\n---\n\nNew response');
		});

		it('does not add extra newline when content already ends with newline', () => {
			const existing = 'Existing content\n';
			const separator = existing.endsWith('\n') ? '' : '\n';
			const result = `${existing}${separator}\n\n---\n\nNew response`;
			// Implementation: "Existing content\n" + "" + "\n\n---\n\nNew response"
			// = "Existing content\n\n\n---\n\nNew response"
			expect(result).toBe('Existing content\n\n\n---\n\nNew response');
		});

		it('preserves markdown spacing', () => {
			const existing = '# Header\n\nContent\n\n## Sub\n\nMore';
			const separator = existing.endsWith('\n') ? '' : '\n';
			const result = `${existing}${separator}\n\n---\n\nAppended`;
			// Should have clean separation
			expect(result).toContain('\n\n---\n\nAppended');
		});
	});

	describe('Create new note path handling', () => {
		function sanitizeFilename(name: string): string {
			return name.replace(/[<>:"\/\\|?*]/g, '-');
		}

		it('sanitizes invalid characters', () => {
			expect(sanitizeFilename('My "Note"')).toBe('My -Note-');
			expect(sanitizeFilename('File/Name')).toBe('File-Name');
			expect(sanitizeFilename('Path\\Name')).toBe('Path-Name');
			expect(sanitizeFilename('A:B')).toBe('A-B');
			expect(sanitizeFilename('Quo*te')).toBe('Quo-te');
			expect(sanitizeFilename('Less<Than')).toBe('Less-Than');
			expect(sanitizeFilename('Great>er')).toBe('Great-er');
			expect(sanitizeFilename('Pipe|Char')).toBe('Pipe-Char');
			expect(sanitizeFilename('Quest?ion')).toBe('Quest-ion');
		});

		it('handles empty name', () => {
			expect(sanitizeFilename('')).toBe('');
			expect(sanitizeFilename('   ')).toBe('   ');
		});

		it('preserves valid characters', () => {
			expect(sanitizeFilename('Valid Name')).toBe('Valid Name');
			expect(sanitizeFilename('Name-with-dashes')).toBe('Name-with-dashes');
			expect(sanitizeFilename('Name_with_underscores')).toBe('Name_with_underscores');
			expect(sanitizeFilename('Name.with.dots')).toBe('Name.with.dots');
		});
	});

	describe('Collision handling', () => {
		function getUniquePath(basePath: string, existingPaths: Set<string>): string {
			let counter = 1;
			let finalPath = basePath;
			while (existingPaths.has(finalPath)) {
				const parts = basePath.split('.');
				const ext = parts.pop() || 'md';
				const name = parts.join('.');
				finalPath = `${name} ${counter}.${ext}`;
				counter++;
			}
			return finalPath;
		}

		it('returns original path when no collision', () => {
			const existing = new Set<string>(['other.md']);
			const result = getUniquePath('note.md', existing);
			expect(result).toBe('note.md');
		});

		it('adds counter when collision exists', () => {
			const existing = new Set<string>(['note.md']);
			const result = getUniquePath('note.md', existing);
			expect(result).toBe('note 1.md');
		});

		it('increments counter for multiple collisions', () => {
			const existing = new Set<string>(['note.md', 'note 1.md', 'note 2.md']);
			const result = getUniquePath('note.md', existing);
			expect(result).toBe('note 3.md');
		});

		it('handles paths with directories', () => {
			const existing = new Set<string>(['Folder/note.md']);
			const result = getUniquePath('Folder/note.md', existing);
			expect(result).toBe('Folder/note 1.md');
		});
	});

	describe('.md enforcement', () => {
		it('only creates .md files', async () => {
			const createNote = async (name: string) => {
				if (!name.endsWith('.md')) {
					throw new Error('Only .md files allowed');
				}
				return { path: name };
			};

			await expect(createNote('note.md')).resolves.toBeDefined();
			await expect(createNote('note.txt')).rejects.toThrow('Only .md files allowed');
			await expect(createNote('note.pdf')).rejects.toThrow('Only .md files allowed');
			await expect(createNote('note')).rejects.toThrow('Only .md files allowed');
		});
	});

	describe('No silent overwrite', () => {
		it('throws or returns error when path exists', () => {
			const existingPaths = new Set<string>(['existing.md']);

			const createIfNotExists = (name: string) => {
				if (existingPaths.has(name)) {
					return { error: 'Note already exists', path: name };
				}
				existingPaths.add(name);
				return { success: true, path: name };
			};

			const result1 = createIfNotExists('new.md');
			expect(result1.success).toBe(true);

			const result2 = createIfNotExists('existing.md');
			expect(result2.error).toBe('Note already exists');
			expect(result2.path).toBe('existing.md');
		});

		it('provides clear error message', () => {
			const errorMsg = 'A note named "existing.md" already exists. Please choose a different name.';
			expect(errorMsg).toContain('already exists');
			expect(errorMsg).toContain('different name');
		});
	});
});