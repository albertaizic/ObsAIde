import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'src/**/*.test.ts',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'vitest.config.ts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// "ObsAIde" and "Aide" are product names, so sentence case must not
		// lowercase them.
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{ brands: ['ObsAIde', 'Aide', 'Obsidian', 'Markdown'] },
			],
			'obsidianmd/ui/sentence-case-json': [
				'warn',
				{ brands: ['ObsAIde', 'Aide'] },
			],
		},
	},
	{
		// The declarative settings API arrived in Obsidian 1.13; this plugin
		// targets 1.7.2, so the settings tab is built imperatively on purpose.
		files: ['src/settings/settings-tab.ts'],
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	{
		// The conversation store is deliberately free of Obsidian and DOM APIs
		// so it can be unit tested; its debounce timer is not window-bound.
		files: ['src/chat/store.ts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	{
		// `requestUrl` cannot expose a readable body, so streaming responses are
		// impossible without `fetch`. Exactly one module is allowed to use it,
		// and it falls back to `requestUrl` whenever `fetch` is refused.
		files: ['src/providers/obsidian-http.ts'],
		rules: {
			'no-restricted-globals': 'off',
		},
	},
	{
		// Build/test tooling, not shipped plugin code, so Node.js APIs are fine.
		files: ['vitest.config.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
);
