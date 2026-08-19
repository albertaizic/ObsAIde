import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian';
import { AIDE_ACTIONS, type AideAction } from '../actions/registry';
import { describeCustomActionAvailability } from '../actions/runner';
import type ObsAidePlugin from '../main';
import type { CustomAction } from '../settings/types';

export type PickableAction = AideAction | CustomAction;

export function isCustomAction(action: PickableAction): action is CustomAction {
	return 'instruction' in action;
}

/** Pick a note action — built-in or custom — used from the editor context menu. */
export class ActionPickerModal extends FuzzySuggestModal<PickableAction> {
	constructor(
		app: App,
		private readonly plugin: ObsAidePlugin,
		private readonly onChoose: (action: PickableAction) => void,
	) {
		super(app);
		this.setPlaceholder('Run an Aide action…');
	}

	getItems(): PickableAction[] {
		const custom = this.plugin.settings.customActions.filter((a) => a.enabled);
		return [...AIDE_ACTIONS, ...custom];
	}

	getItemText(action: PickableAction): string {
		return isCustomAction(action) ? action.name : action.label;
	}

	override renderSuggestion(match: FuzzyMatch<PickableAction>, el: HTMLElement): void {
		const action = match.item;
		el.addClass('obsaide-model-suggestion');
		el.createDiv({ cls: 'obsaide-model-title', text: this.getItemText(action) });

		if (isCustomAction(action)) {
			const availability = describeCustomActionAvailability(this.plugin, action);
			el.createDiv({
				cls: 'obsaide-model-meta',
				text: availability.available
					? 'Custom action · Answers in the Aide sidebar'
					: `Custom action · ${availability.reason}`,
			});
			return;
		}

		el.createDiv({
			cls: 'obsaide-model-meta',
			text: action.mutates
				? 'Proposes replacement text you review before applying'
				: 'Answers in the Aide sidebar',
		});
	}

	onChooseItem(action: PickableAction): void {
		this.onChoose(action);
	}
}
