// The first column of the encounter window: the encounter picker with its
// menu, the initiative buttons over the round and the turn order, where the
// gamemaster types a value, and the gamemaster's notes.
import { useRef, useState } from "preact/hooks";
import { encounter, encounterList, notes, shownGroups, type GroupView } from "../state";
import {
    createEncounter, deleteEncounter, describeEncounter, loadEncounterFiles, nextTurn, pickEncounter, prevTurn, renameEncounter, replaceNpcsFromFile,
    resetInitiative, rollForNpcs, sendDescription, setInitiative, toggleShown,
} from "../actions";
import { exportUrl } from "../files";
import { useClickOutside } from "../../components/useClickOutside";

const JSON_FILES = ".json,application/json";

/** The files picked, with the input emptied so that the same file can be picked again. */
function takeFiles(e: Event): File[] {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...input.files ?? []];
    input.value = "";
    return files;
}

export function InitiativeColumn() {
    const state = encounter.value;
    const shown = state !== null && encounterList.value?.shownEncounterId === state.id;
    return (
        <div class="encounter-column initiative-column">
            {/* Above the scrolled body, which would cut its menu off. */}
            <div class="encounter-column-header">
                <EncounterPicker />
                {state && (
                    <section class="encounter-initiative" aria-label="Initiative">
                        <h3 class="encounter-section-title encounter-round">
                            <span>Initiative</span>
                            <span class="spacer" />
                            <span>Round <b>{state.round}</b></span>
                        </h3>
                        <div class="encounter-initiative-actions">
                            <button type="button" class="encounter-reset" title="Clear everyone's initiative" onClick={resetInitiative}>Reset</button>
                            <button type="button" class="encounter-roll-npcs" onClick={rollForNpcs}>Roll for NPCs</button>
                            <button type="button" class="encounter-show" aria-pressed={shown} onClick={toggleShown}>Show to players</button>
                            <button type="button" class="encounter-prev" onClick={prevTurn}>⏮ Prev</button>
                            <button type="button" class="encounter-next" onClick={nextTurn}>Next ⏭</button>
                        </div>
                    </section>
                )}
            </div>
            <div class="encounter-column-body encounter-order">
                {state && shownGroups.value.map(g => <OrderRow key={g.id} group={g} current={g.id === state.currentGroupId} />)}
            </div>
            {state && <Notes key={state.id} text={notes.value} />}
        </div>
    );
}

function EncounterPicker() {
    const list = encounterList.value;
    const state = encounter.value;
    const [menu, setMenu] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    // Out of the menu, which is gone by the time a file is picked; the link
    // too, so that "Export" is a button like the other items.
    const loadInput = useRef<HTMLInputElement>(null);
    const replaceInput = useRef<HTMLInputElement>(null);
    const exportLink = useRef<HTMLAnchorElement>(null);
    useClickOutside(box, menu, () => setMenu(false));
    const act = (action: () => void) => () => {
        setMenu(false);
        action();
    };
    const inputs = (
        <>
            <input type="file" hidden multiple accept={JSON_FILES} ref={loadInput} class="encounter-load-input"
                aria-label="Encounter files to load" onChange={e => void loadEncounterFiles(takeFiles(e))} />
            <input type="file" hidden accept={JSON_FILES} ref={replaceInput} class="encounter-replace-input"
                aria-label="Encounter file whose NPCs to take" onChange={e => {
                    const [file] = takeFiles(e);
                    if (file) void replaceNpcsFromFile(file);
                }} />
        </>
    );

    if (!list?.encounters.length) {
        return (
            <div class="layout-column encounter-empty">
                <button type="button" class="button-wide button-colored encounter-create" onClick={createEncounter}>New encounter</button>
                <button type="button" class="button-wide encounter-load" onClick={() => loadInput.current?.click()}>Load from files…</button>
                {inputs}
            </div>
        );
    }
    return (
        <div class="encounter-picker" ref={box}>
            {inputs}
            {state && <a hidden ref={exportLink} class="encounter-export-link" href={exportUrl(state.id)} download />}
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
                    <button type="button" role="menuitem" class="encounter-load" onClick={act(() => loadInput.current?.click())}>
                        Load from files…
                    </button>
                    {state && (
                        <>
                            <button type="button" role="menuitem" onClick={act(() => setRenaming(true))}>Rename</button>
                            <button type="button" role="menuitem" class="encounter-export" onClick={act(() => exportLink.current?.click())}>
                                Export
                            </button>
                            <button type="button" role="menuitem" class="encounter-replace-npcs" onClick={act(() => replaceInput.current?.click())}>
                                Replace NPCs from file…
                            </button>
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

/**
 * The gamemaster's notes of the encounter, which the players never get. While
 * the field has the focus, notes from another tab leave what is typed alone.
 */
function Notes({ text }: { text: string }) {
    const [value, setValue] = useState(text);
    const focused = useRef(false);
    // Typed into since it got the focus: its text is sent and becomes the notes.
    const typed = useRef(false);
    const seen = useRef(text);
    if (seen.current !== text) {
        seen.current = text;
        if (!focused.current) setValue(text);
    }
    return (
        <section class="encounter-notes-box" aria-label="Encounter notes">
            <h3 class="encounter-section-title">Encounter notes</h3>
            <textarea class="encounter-notes" value={value} maxLength={10000} placeholder="Only you see them"
                aria-label="Notes for this encounter"
                onFocus={() => {
                    focused.current = true;
                    typed.current = false;
                }}
                onInput={e => {
                    typed.current = true;
                    setValue(e.currentTarget.value);
                    describeEncounter(e.currentTarget.value);
                }}
                onBlur={() => {
                    focused.current = false;
                    sendDescription();
                    // Untouched, the field takes what came while it had the focus.
                    if (!typed.current) setValue(seen.current);
                }} />
        </section>
    );
}
