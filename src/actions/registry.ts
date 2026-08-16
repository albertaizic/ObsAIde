import { ACTION_PROMPTS, type ActionPrompt } from '../prompts/actions';

/**
 * A note action is a named prompt plus a little metadata.
 *
 * Adding one means adding an entry to {@link AIDE_ACTIONS}; everything else —
 * commands, the editor menu, streaming, the apply flow — is driven from this
 * table.
 */
export interface AideAction {
	/** Stable suffix of the command ID. Never rename after release. */
	id: string;
	/** Short name shown on the message tag and in the editor menu. */
	label: string;
	/** Command palette entry. */
	commandName: string;
	icon: string;
	/** Whether the reply is meant to replace note content. */
	mutates: boolean;
	/** Ask the user for a free-form instruction before running. */
	needsInstruction?: boolean;
	instructionPrompt?: string;
	build: (instruction: string) => ActionPrompt;
}

export const AIDE_ACTIONS: readonly AideAction[] = [
	{
		id: 'explain',
		label: 'Explain',
		commandName: 'Explain with Aide',
		icon: 'lightbulb',
		mutates: false,
		build: () => ACTION_PROMPTS.explain(),
	},
	{
		id: 'summarize',
		label: 'Summarise',
		commandName: 'Summarise with Aide',
		icon: 'list',
		mutates: false,
		build: () => ACTION_PROMPTS.summarize(),
	},
	{
		id: 'tutor',
		label: 'Teach me',
		commandName: 'Teach me with Aide',
		icon: 'graduation-cap',
		mutates: false,
		build: () => ACTION_PROMPTS.tutor(),
	},
	{
		id: 'improve',
		label: 'Improve writing',
		commandName: 'Improve writing with Aide',
		icon: 'wand-sparkles',
		mutates: true,
		build: () => ACTION_PROMPTS.improve(),
	},
	{
		id: 'rewrite',
		label: 'Rewrite',
		commandName: 'Rewrite with Aide',
		icon: 'pencil',
		mutates: true,
		needsInstruction: true,
		instructionPrompt: 'How should Aide rewrite this?',
		build: (instruction) => ACTION_PROMPTS.rewrite(instruction),
	},
	{
		id: 'shorten',
		label: 'Shorten',
		commandName: 'Shorten with Aide',
		icon: 'fold-vertical',
		mutates: true,
		build: () => ACTION_PROMPTS.shorten(),
	},
	{
		id: 'expand',
		label: 'Expand',
		commandName: 'Expand with Aide',
		icon: 'unfold-vertical',
		mutates: true,
		build: () => ACTION_PROMPTS.expand(),
	},
];

export function findAction(id: string): AideAction | undefined {
	return AIDE_ACTIONS.find((action) => action.id === id);
}
