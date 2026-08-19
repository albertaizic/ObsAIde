import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, TFile, TFolder } from 'obsidian';
import { VaultSearchResult, searchVault, buildSearchIndex, searchIndex, clearSearchIndex } from './vault-search';

// Mock Obsidian App and vault
function createMockApp(files: MockFile[]): App {
  const markdownFiles = files.filter(f => f.extension === 'md').map(f => ({
    path: f.path,
    basename: f.name,
    extension: 'md',
    stat: { mtime: f.mtime },
    parent: { path: f.folderPath || '' },
  })) as TFile[];

  return {
    vault: {
      getMarkdownFiles: vi.fn(() => markdownFiles),
      getAbstractFileByPath: vi.fn((path: string) => {
        const file = files.find(f => f.path === path);
        if (!file) return null;
        return {
          path: file.path,
          basename: file.name,
          extension: file.extension,
        } as TFile;
      }),
      cachedRead: vi.fn(async (file: TFile) => {
        const f = files.find(mf => mf.path === file.path);
        return f?.content || '';
      }),
    },
    metadataCache: {
      getFileCache: vi.fn(() => ({ frontmatter: {}, links: [], headings: [] })),
      getFirstLinkpathDest: vi.fn(() => null),
    },
    workspace: {
      getActiveFile: vi.fn(() => null),
      getActiveViewOfType: vi.fn(() => null),
    },
  } as unknown as App;
}

interface MockFile {
  path: string;
  name: string;
  folderPath: string;
  extension: string;
  content: string;
  mtime: number;
}

describe('vault-search', () => {
  let mockApp: App;
  const now = Date.now();

  beforeEach(() => {
    clearSearchIndex();
    const files: MockFile[] = [
      {
        path: 'Algorithms/Binary Search.md',
        name: 'Binary Search',
        folderPath: 'Algorithms',
        extension: 'md',
        content: '# Binary Search\n\nBinary search repeatedly halves the search space.\n\n## Complexity\n\nTime complexity is O(log n).',
        mtime: now - 1000,
      },
      {
        path: 'Algorithms/Dijkstra.md',
        name: 'Dijkstra',
        folderPath: 'Algorithms',
        extension: 'md',
        content: '# Dijkstra Algorithm\n\nFinds shortest paths in a weighted graph.\n\n## Implementation\n\nUses a priority queue.',
        mtime: now - 2000,
      },
      {
        path: 'Coursework/Graphs.md',
        name: 'Graphs',
        folderPath: 'Coursework',
        extension: 'md',
        content: '# Graph Theory\n\nGraphs consist of vertices and edges.\n\n## Shortest Path\n\nDijkstra finds the shortest path.',
        mtime: now - 3000,
      },
      {
        path: 'Journal/2026-08-18.md',
        name: '2026-08-18',
        folderPath: 'Journal',
        extension: 'md',
        content: '# Daily Note\n\nStudied binary search today.',
        mtime: now - 4000,
      },
      {
        path: 'Algorithms/Sorting.md',
        name: 'Sorting',
        folderPath: 'Algorithms',
        extension: 'md',
        content: '# Sorting Algorithms\n\nQuick sort, merge sort, bubble sort.',
        mtime: now - 5000,
      },
    ];
    mockApp = createMockApp(files);
  });

  describe('buildSearchIndex', () => {
    it('builds index from vault markdown files', async () => {
      const index = await buildSearchIndex(mockApp);
      expect(index.size).toBe(5);
    });

    it('indexes title, path, headings, and content', async () => {
      const index = await buildSearchIndex(mockApp);
      const binarySearch = index.get('Algorithms/Binary Search.md');
      expect(binarySearch).toBeDefined();
      expect(binarySearch?.title).toBe('Binary Search');
      expect(binarySearch?.path).toBe('Algorithms/Binary Search.md');
      expect(binarySearch?.headings).toContain('Complexity');
      expect(binarySearch?.content).toContain('halves the search space');
    });
  });

  describe('searchVault', () => {
    it('returns empty array for empty query', async () => {
      const results = await searchVault(mockApp, '');
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace-only query', async () => {
      const results = await searchVault(mockApp, '   ');
      expect(results).toEqual([]);
    });

    it('matches by title (case-insensitive)', async () => {
      const results = await searchVault(mockApp, 'binary');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title.toLowerCase()).toContain('binary');
    });

    it('matches by path', async () => {
      const results = await searchVault(mockApp, 'algorithms');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.path.includes('Algorithms'))).toBe(true);
    });

    it('matches by content keywords', async () => {
      const results = await searchVault(mockApp, 'halves');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toContain('halves');
    });

    it('ranks exact phrase matches higher', async () => {
      const results = await searchVault(mockApp, 'shortest path');
      expect(results.length).toBeGreaterThan(0);
      // Both Dijkstra and Graphs mention "shortest path"
      expect(results.some(r => r.title === 'Dijkstra')).toBe(true);
      expect(results.some(r => r.title === 'Graphs')).toBe(true);
    });

    it('ranks title matches higher than content matches', async () => {
      const results = await searchVault(mockApp, 'binary');
      // Binary Search.md has "binary" in title, Journal has it in content
      expect(results[0].title).toBe('Binary Search');
    });

    it('handles multiple search terms (all must match)', async () => {
      const results = await searchVault(mockApp, 'binary search');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Binary Search');
    });

    it('is case-insensitive', async () => {
      const results1 = await searchVault(mockApp, 'DIJKSTRA');
      const results2 = await searchVault(mockApp, 'dijkstra');
      const results3 = await searchVault(mockApp, 'Dijkstra');
      expect(results1.length).toBe(results2.length);
      expect(results2.length).toBe(results3.length);
    });

    it('limits results to default max (50)', async () => {
      // Create many files
      const manyFiles: MockFile[] = [];
      for (let i = 0; i < 100; i++) {
        manyFiles.push({
          path: `Notes/Note ${i}.md`,
          name: `Note ${i}`,
          folderPath: 'Notes',
          extension: 'md',
          content: `Content ${i}`,
          mtime: now - i,
        });
      }
      const app = createMockApp(manyFiles);
      const results = await searchVault(app, 'note');
      expect(results.length).toBeLessThanOrEqual(50);
    });

    it('respects custom limit option', async () => {
      const results = await searchVault(mockApp, 'algorithm', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('includes matched heading when relevant', async () => {
      const results = await searchVault(mockApp, 'complexity');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedHeading).toBeDefined();
    });

    it('only searches markdown files', async () => {
      const files: MockFile[] = [
        { path: 'Notes/test.md', name: 'test', folderPath: 'Notes', extension: 'md', content: 'markdown content', mtime: now },
        { path: 'Notes/image.png', name: 'image', folderPath: 'Notes', extension: 'png', content: '', mtime: now },
        { path: 'Notes/doc.pdf', name: 'doc', folderPath: 'Notes', extension: 'pdf', content: '', mtime: now },
      ];
      const app = createMockApp(files);
      const results = await searchVault(app, 'content');
      expect(results.length).toBe(1);
      expect(results[0].path).toBe('Notes/test.md');
    });

    it('returns snippet with matched term highlighted context', async () => {
      const results = await searchVault(mockApp, 'priority queue');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toContain('priority queue');
    });

    it('handles punctuation in query', async () => {
      const results = await searchVault(mockApp, 'O(log n)');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Binary Search');
    });

    it('handles partial word matches', async () => {
      const results = await searchVault(mockApp, 'dijk');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Dijkstra');
    });
  });

  describe('searchIndex (low-level)', () => {
    it('scores title matches highest', () => {
      const index = new Map([
        ['a.md', { title: 'Exact Match', path: 'a.md', content: '', headings: [], mtime: 0 }],
        ['b.md', { title: 'Other', path: 'b.md', content: 'Exact Match in content', headings: [], mtime: 0 }],
      ]);
      const results = searchIndex(index, 'exact match');
      expect(results[0].title).toBe('Exact Match');
    });

    it('scores heading matches above content', () => {
      const index = new Map([
        ['a.md', { title: 'Note A', path: 'a.md', content: 'content', headings: ['Important Heading'], mtime: 0 }],
        ['b.md', { title: 'Note B', path: 'b.md', content: 'Important Heading in content', headings: [], mtime: 0 }],
      ]);
      const results = searchIndex(index, 'important heading');
      expect(results[0].title).toBe('Note A');
    });
  });
});