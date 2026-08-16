import type { Component } from 'obsidian';

/** How close to the bottom still counts as "following the conversation". */
const PIN_THRESHOLD_PX = 64;

/**
 * Keeps a scrolling transcript at the latest message.
 *
 * Markdown rendering is asynchronous, so the height of the transcript changes
 * after the code that added a message has finished. Rather than guessing with a
 * timeout, this watches the content box for resizes and re-pins whenever the
 * user is still following along. Deliberately scrolling up unpins it, and
 * nothing drags the viewport back until the user sends, switches conversation,
 * or asks to jump to the latest.
 */
export class BottomScroller {
	private pinnedState = true;
	/** Set while we are moving the scroller ourselves. */
	private ignoreScroll = false;
	private frame: number | null = null;

	constructor(
		private readonly scroller: HTMLElement,
		content: HTMLElement,
		parent: Component,
		private readonly onPinnedChange?: (pinned: boolean) => void,
	) {
		parent.registerDomEvent(this.scroller, 'scroll', () => {
			if (this.ignoreScroll) return;
			this.setPinned(this.distanceFromBottom() <= PIN_THRESHOLD_PX);
		});

		const observer = new ResizeObserver(() => {
			if (this.pinnedState) this.jump();
		});
		observer.observe(content);
		parent.register(() => {
			observer.disconnect();
			this.cancelFrame();
		});
	}

	get pinned(): boolean {
		return this.pinnedState;
	}

	/** Return to the latest message and follow it again. */
	pin(): void {
		this.setPinned(true);
		this.jump();
		this.settle();
	}

	/**
	 * Hold the reading position across a full rebuild of the transcript.
	 *
	 * Re-rendering empties the scroller, which would otherwise dump a user who
	 * had scrolled up back at the very top the moment a reply finishes. Distance
	 * from the bottom is the stable measure here, because structural changes
	 * only ever append.
	 *
	 * Returns the function to call once the new content is in place.
	 */
	preserve(): () => void {
		if (this.pinnedState) return () => this.settle();

		const distance = this.distanceFromBottom();
		return () => {
			this.ignoreScroll = true;
			this.scroller.scrollTop = Math.max(
				0,
				this.scroller.scrollHeight - this.scroller.clientHeight - distance,
			);
			window.requestAnimationFrame(() => {
				this.ignoreScroll = false;
			});
		};
	}

	/**
	 * Re-check the scroll position once layout has settled.
	 *
	 * Two frames: the first lets the browser apply the new DOM, the second runs
	 * after the resulting layout pass.
	 */
	settle(): void {
		this.cancelFrame();
		this.frame = window.requestAnimationFrame(() => {
			this.frame = window.requestAnimationFrame(() => {
				this.frame = null;
				if (this.pinnedState) this.jump();
			});
		});
	}

	private distanceFromBottom(): number {
		return (
			this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight
		);
	}

	private jump(): void {
		this.ignoreScroll = true;
		this.scroller.scrollTop = this.scroller.scrollHeight;
		// Release on the next frame so our own write cannot unpin us.
		window.requestAnimationFrame(() => {
			this.ignoreScroll = false;
		});
	}

	private setPinned(pinned: boolean): void {
		if (this.pinnedState === pinned) return;
		this.pinnedState = pinned;
		this.onPinnedChange?.(pinned);
	}

	private cancelFrame(): void {
		if (this.frame !== null) {
			window.cancelAnimationFrame(this.frame);
			this.frame = null;
		}
	}
}
