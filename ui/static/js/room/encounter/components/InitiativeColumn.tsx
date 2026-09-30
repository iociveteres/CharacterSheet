// The first column of the encounter window: the encounter picker with its
// menu, the round and the turn order, where the gamemaster types a value.
import { useRef, useState } from "preact/hooks";
import { encounter, encounterList, groups, type GroupView } from "../state";
import {
    createEncounter, deleteEncounter, nextTurn, pickEncounter, renameEncounter, resetInitiative, rollForNpcs,
    setInitiative, toggleShown,
} from "../actions";
import { useClickOutside } from "../../components/useClickOutside";

export function InitiativeColumn() {
    const state = encounter.value;
    return (
        <div class="encounter-column initiative-column">
            <div class="encounter-column-body">
                <EncounterPicker />
                {state && (
                    <>
                        <div class="encounter-round">Round <b>{state.round}</b></div>
                        {groups.value.map(g => <OrderRow key={g.id} group={g} current={g.id === state.currentGroupId} />)}
                    </>
                )}
            </div>
            {state && (
                <div class="encounter-column-footer">
                    <button type="button" class="encounter-roll-npcs" onClick={rollForNpcs}>Roll for NPCs</button>
                    <button type="button" class="encounter-next button-colored" onClick={nextTurn}>Next ⏭</button>
                </div>
            )}
        </div>
    );
}

function EncounterPicker() {
    const list = encounterList.value;
    const state = encounter.value;
    const [menu, setMenu] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    useClickOutside(box, menu, () => setMenu(false));
    const act = (action: () => void) => () => {
        setMenu(false);
        action();
    };

    if (!list?.encounters.length) {
        return <button type="button" class="button-wide button-colored encounter-create" onClick={createEncounter}>New encounter</button>;
    }
    return (
        <div class="encounter-picker" ref={box}>
            {renaming && state ? (
                <input class="encounter-rename" value={state.name} aria-label="Encounter name" autoFocus maxLength={100}
                    onKeyDown={e => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenaming(false);
                    }}
                    onBlur={e => {
                        if (renaming) renameEncounter(e.currentTarget.value);
                        setRenaming(false);
                    }} />
            ) : (
                <select value={state?.id ?? ""} aria-label="Encounter" onChange={e => pickEncounter(Number(e.currentTarget.value))}>
                    {!state && <option value="">—</option>}
                    {list.encounters.map(e => (
                        <option key={e.id} value={e.id}>{e.id === list.shownEncounterId ? `👁 ${e.name}` : e.name}</option>
                    ))}
                </select>
            )}
            <button type="button" class="encounter-menu-btn" aria-label="Encounter menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
            {menu && (
                <div class="encounter-menu" role="menu">
                    <button type="button" role="menuitem" onClick={act(createEncounter)}>New encounter</button>
                    {state && (
                        <>
                            <button type="button" role="menuitem" onClick={act(() => setRenaming(true))}>Rename</button>
                            <button type="button" role="menuitem" class="encounter-show" onClick={act(toggleShown)}>
                                {list.shownEncounterId === state.id ? "Hide from players" : "Show to players"}
                            </button>
                            <button type="button" role="menuitem" onClick={act(() => void resetInitiative())}>Reset initiative</button>
                            <button type="button" role="menuitem" class="danger" onClick={act(() => void deleteEncounter())}>Delete</button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/** A group in the turn order; a click on its value lets the gamemaster type one. */
function OrderRow({ group, current }: { group: GroupView; current: boolean }) {
    const [editing, setEditing] = useState(false);
    const classes = ["encounter-order-row", current && "current", group.value === null && "encounter-muted"].filter(Boolean).join(" ");
    const commit = (text: string) => {
        setEditing(false);
        const value = text.trim() === "" ? null : Number(text);
        if (value === null || Number.isInteger(value)) setInitiative(group.id, value);
    };
    return (
        <div class={classes} data-group-id={group.id}>
            <span class="encounter-order-name">{group.label}</span>
            {editing ? (
                <input class="encounter-order-input" type="number" aria-label={`Initiative of ${group.label}`} autoFocus
                    value={group.value ?? ""}
                    onKeyDown={e => {
                        if (e.key === "Enter") commit(e.currentTarget.value);
                        if (e.key === "Escape") setEditing(false);
                    }}
                    onBlur={e => editing && commit(e.currentTarget.value)} />
            ) : (
                <button type="button" class="encounter-order-value" title="Type the initiative" onClick={() => setEditing(true)}>
                    {group.value ?? "—"}
                </button>
            )}
        </div>
    );
}
