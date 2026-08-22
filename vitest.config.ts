import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./src/test/obsidian-stub.ts', import.meta.url)),
		},
	},
});
