// The installed 'obsidian' package ships type declarations only (its
// package.json has an empty "main" field), which some Vite/Rollup versions
// fail to resolve as a module entry. vitest.config.ts aliases every 'obsidian'
// import to this stub so the real npm package is never resolved at test time.
// Individual test files still override what they need via vi.mock('obsidian', ...).

export class Notice {
	constructor(..._args: unknown[]) {}
}

export class Component {}

export class Plugin extends Component {}

export class Modal extends Component {
	constructor(..._args: unknown[]) {
		super();
	}
}

export class PluginSettingTab {
	constructor(..._args: unknown[]) {}
}

export class Setting {
	constructor(..._args: unknown[]) {}
}

export class FuzzySuggestModal extends Modal {}

export class Menu {}

export class TFile {}

export class TFolder {}

export class MarkdownView {}

export class MarkdownRenderer {}

export const Platform = {
	isMobile: false,
	isDesktop: true,
};

export function setIcon(..._args: unknown[]): void {}

export function setTooltip(..._args: unknown[]): void {}

export function normalizePath(path: string): string {
	return path;
}

export function requestUrl(..._args: unknown[]): never {
	throw new Error('requestUrl is not available in tests; mock it explicitly.');
}
