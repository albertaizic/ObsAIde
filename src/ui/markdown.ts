import { Component, MarkdownRenderer, Notice, setIcon, setTooltip, type App } from 'obsidian';

/**
 * A re-renderable block of Markdown.
 *
 * Streaming replies change many times a second, so each render gets its own
 * child `Component`: unloading it tears down whatever the previous render
 * registered (embeds, callouts, code block post-processors) instead of leaking
 * it.
 */
export class MarkdownBlock {
	private child: Component | null = null;
	private renderToken = 0;
	private lastMarkdown: string | null = null;

	constructor(
		private readonly app: App,
		private readonly el: HTMLElement,
		private readonly parent: Component,
		private readonly sourcePath: string,
	) {}

	async render(markdown: string): Promise<void> {
		if (markdown === this.lastMarkdown) return;
		this.lastMarkdown = markdown;

		const token = ++this.renderToken;
		const child = new Component();
		// Added before rendering so anything the renderer registers is owned by
		// a loaded component, and `removeChild` can tear all of it down again.
		this.parent.addChild(child);
		const container = createDiv();

		await MarkdownRenderer.render(this.app, markdown, container, this.sourcePath, child);
		// A newer render started while this one was awaiting; drop this result.
		if (token !== this.renderToken) {
			this.parent.removeChild(child);
			return;
		}

		if (this.child) this.parent.removeChild(this.child);
		this.child = child;

		this.el.empty();
		this.el.append(...Array.from(container.childNodes));
		addCodeBlockCopyButtons(this.el);
	}

	destroy(): void {
		this.renderToken += 1;
		if (this.child) this.parent.removeChild(this.child);
		this.child = null;
	}
}

/** Give every fenced code block its own copy button. */
export function addCodeBlockCopyButtons(root: HTMLElement): void {
	root.findAll('pre').forEach((pre) => {
		if (!pre.querySelector('code')) return;
		if (pre.querySelector('.obsaide-copy-code')) return;
		pre.addClass('obsaide-pre');
		const button = pre.createEl('button', { cls: 'obsaide-copy-code' });
		setIcon(button, 'copy');
		setTooltip(button, 'Copy code');
		button.setAttribute('aria-label', 'Copy code');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void copyToClipboard(pre.querySelector('code')?.textContent ?? '', 'Code copied');
		});
	});
}

export async function copyToClipboard(text: string, message = 'Copied'): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(message);
	} catch {
		new Notice('Could not copy to the clipboard.');
	}
}
