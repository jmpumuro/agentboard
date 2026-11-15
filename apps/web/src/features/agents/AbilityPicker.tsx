import type { Ability } from 'contract';
import { ABILITIES, DEFAULT_ABILITIES } from 'contract';
export function AbilityPicker({ selected = DEFAULT_ABILITIES }: {
    selected?: Ability[];
}) {
    return <fieldset className="ability-picker"><legend>What this agent may do</legend><p className="always-readable">✓ See everything on its boards</p>{ABILITIES.map(ability => <label className="check ability-choice" key={ability.id}><input type="checkbox" name="capabilities" value={ability.id} defaultChecked={selected.includes(ability.id)}/><span><strong>{ability.label}</strong><small>{ability.description}</small></span></label>)}<p className="help">Write access is enabled when Add, Draw, Edit, or Delete is selected. Workspace deletion rules still apply.</p></fieldset>;
}
