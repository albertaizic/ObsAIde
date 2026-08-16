import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian';
import { AIDE_ACTIONS, type AideAction } from '../actions/registry';

/** Pick a note action, used from the editor context menu. */
export class ActionPickerModal extends FuzzySuggestModal<AideAction> {
	constructor(
		app: App,
		private readonly onChoose: (action: AideAction) => void,
	) {
		super(app);
		this.setPlaceholder('Run an Aide action…');
	}

	getItems(): AideAction[] {
		return [...AIDE_ACTIONS];
	}

	getItemText(action: AideAction): string {
		return action.label;
	}

	override renderSuggestion(match: FuzzyMatch<AideAction>, el: HTMLElement): void {
		const action = match.item;
		el.addClass('obsaide-model-suggestion');
		el.createDiv({ cls: 'obsaide-model-title', text: action.label });
		el.createDiv({
			cls: 'obsaide-model-meta',
			text: action.mutates
				? 'Proposes replacement text you review before applying'
				: 'Answers in the Aide sidebar',
		});
	}

	onChooseItem(action: AideAction): void {
		this.onChoose(action);
	}
}
