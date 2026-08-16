/**
 * Prompt templates for the note actions.
 *
 * Keeping the wording here means the action registry stays a small table of
 * metadata and the UI never contains prompt text.
 */

/** Appended to every action that returns Markdown meant to replace content. */
export const REWRITE_CONTRACT = `Output requirements:
- Return only the rewritten Markdown. No preamble, no explanation, no sign-off.
- Do not wrap the whole answer in a code fence unless the original was fenced.
- Preserve the original Markdown structure: headings, lists, links, callouts, code blocks, footnotes and front matter.
- Keep the author's voice and language. Never translate unless asked.
- Do not invent facts, citations or references that are not in the source.`;

export interface ActionPrompt {
	/** Extra system instructions for this action. */
	system: string;
	/** The instruction sent as the user turn, above the attached context. */
	user: string;
}

export const ACTION_PROMPTS = {
	explain: (): ActionPrompt => ({
		system:
			'You explain material the user is reading. Lead with the core idea in one or two sentences, then unpack it. Define jargon the first time it appears.',
		user: 'Explain the attached material. Start with what it is really saying, then break down anything subtle or easy to misread.',
	}),

	summarize: (): ActionPrompt => ({
		system:
			'You write summaries that stand on their own. Prefer specifics over generalities, and never pad to reach a length.',
		user: 'Summarise the attached material. Give a one-sentence summary, then the key points as a short bullet list. Keep names, numbers and terminology exact.',
	}),

	improve: (): ActionPrompt => ({
		system: `You improve writing without changing what it says.\n\n${REWRITE_CONTRACT}`,
		user: 'Improve the clarity, flow and structure of the attached text. Fix grammar and awkward phrasing, tighten wordy sentences, and improve headings or list structure where that genuinely helps. Do not add new claims and do not remove information.',
	}),

	rewrite: (instruction: string): ActionPrompt => ({
		system: `You rewrite text to the user's instruction.\n\n${REWRITE_CONTRACT}`,
		user: `Rewrite the attached text according to this instruction:\n\n${instruction}`,
	}),

	shorten: (): ActionPrompt => ({
		system: `You make text more concise while keeping every substantive point.\n\n${REWRITE_CONTRACT}`,
		user: 'Make the attached text more concise. Cut redundancy, hedging and filler. Keep every distinct fact, name and number. Aim for roughly half the length unless that would lose meaning.',
	}),

	expand: (): ActionPrompt => ({
		system: `You develop text further without padding it.\n\n${REWRITE_CONTRACT}`,
		user: 'Develop the attached text further. Add the detail, reasoning and concrete examples a reader would need, staying strictly on the topic already there. Flag anything you are unsure of rather than inventing it.',
	}),

	tutor: (): ActionPrompt => ({
		system:
			'You are teaching this material, not answering a question about it. Build understanding step by step and check it at the end.',
		user: 'Teach me the attached material. Start with the intuition, then the mechanics, then a worked example. Point out where people usually go wrong, and finish with one question that tests whether I understood the key idea.',
	}),
} as const;
