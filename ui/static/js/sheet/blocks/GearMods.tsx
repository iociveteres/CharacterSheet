// The mods of a gear item's armour: a line of chips, and under it the details
// of the open mod or the line that adds one. Weights and entries of the mods
// count in state/computed.ts (gearMods).
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { nanoid } from "nanoid";
import { AutocompleteDropdown, AutocompleteField, useAutocompleteInput } from "../components/AutocompleteField";
import { nameAndTypeOption } from "../components/autocompleteOptions";
import { columnsFromLayout, createAtEnd } from "../components/columns";
import { joinPath, usePath, useSheet, type AutocompleteResult } from "../components/context";
import { NumberField, TextArea } from "../components/fields";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { valueAt } from "../state/sync";
import { ItemEntries } from "./ConditionEntries";

const COLLECTION = "armourMods";

/** The chip of the mod `itemId`: its name opens the details, ✖ deletes it in Delete Mode. */
function ModChip({ itemId, open, onToggle }: { itemId: string; open: boolean; onToggle: () => void }) {
    const { state, canEdit, actions } = useSheet();
    const path = joinPath(usePath(), itemId);
    const name = String(valueAt(state, `${path}.name`) ?? "").trim();
    const hasEntries = useItemIds(`${path}.entries.items`).ids.length > 0;
    let cls = "mod-chip";
    if (open) cls += " open";
    if (hasEntries) cls += " has-entries";
    return (
        <span class={cls}>
            <button type="button" class="mod-chip-name" title={hasEntries ? "The mod has conditions" : undefined} onClick={onToggle}>
                {name || "—"}
            </button>
            {canEdit && <button type="button" class="mod-delete" title="Delete the mod" onClick={() => actions.deleteItem(path)}>✖</button>}
        </span>
    );
}

function ModDetails({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="mod-details">
            <div class="mod-header">
                <AutocompleteField field="name" class="mod-name textlike" placeholder="Name" itemPath={path} collection={COLLECTION} />
                <NumberField field="weight" class="short textlike" placeholder="wt." />
                <span class="mod-unit">kg</span>
            </div>
            <TextArea field="description" class="mod-description" placeholder=" " />
            <ItemEntries itemId={itemId} itemPath={path} framed={false} />
        </Scope>
    );
}

/**
 * The line that adds a mod at the end of `order`: a pick lays the
 * collection's mod over it, Enter on a typed name adds a mod of that name.
 * Esc, or leaving it empty, closes it.
 */
function AddMod({ order, onAdded, onClose }: { order: string[]; onAdded: (itemId: string) => void; onClose: () => void }) {
    const { autocomplete, actions } = useSheet();
    const gridPath = usePath();
    const inputRef = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => inputRef.current?.focus(), []);

    const add = (name: string): string => {
        const itemId = `mod-${nanoid()}`;
        createAtEnd(actions, gridPath, [order], 0, itemId, { name });
        onAdded(itemId);
        return joinPath(gridPath, itemId);
    };
    const pick = (result: AutocompleteResult) => {
        autocomplete?.close();
        actions.autocompleteApply(add(result.name), COLLECTION, result.name);
    };
    useAutocompleteInput(inputRef, COLLECTION, pick);

    // Preact's listener runs before the autocomplete's, which picks the active option.
    const onKeyDown = (e: KeyboardEvent) => {
        const input = e.currentTarget as HTMLInputElement;
        // The sheet's Enter would move to the next field of the item.
        if (e.key === "Enter") e.stopPropagation();
        const s = autocomplete?.suggestions.peek();
        if (s?.input === input && s.active >= 0) return;
        if (e.key === "Enter" && input.value.trim()) {
            e.preventDefault();
            autocomplete?.close(input);
            add(input.value.trim());
        } else if (e.key === "Escape") {
            onClose();
        }
    };

    return (
        <div class="mod-add">
            <input type="text" ref={inputRef} placeholder="Add mod…" onKeyDown={onKeyDown}
                onBlur={e => { if (!e.currentTarget.value.trim()) onClose(); }} />
            {autocomplete && <AutocompleteDropdown autocomplete={autocomplete} inputRef={inputRef} renderOption={nameAndTypeOption} onPick={pick} />}
        </div>
    );
}

/** The mods of the armour at the enclosing path; one mod is open at a time. */
export function GearMods() {
    const { canEdit } = useSheet();
    const { ids, layouts } = useItemIds(joinPath(usePath(), "mods.items"));
    const [open, setOpen] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    if (!canEdit && ids.length === 0) return null;

    const order = columnsFromLayout(1, layouts, ids)[0];
    // A deleted mod closes.
    const shown = !adding && open !== null && ids.includes(open) ? open : null;
    const toggle = (id: string) => {
        setAdding(false);
        setOpen(id === shown ? null : id);
    };

    return (
        <Scope dataId="mods.items" class="gear-mods">
            <div class="gear-mods-row">
                <span class="mods-label">Mods:</span>
                {order.map(id => <ModChip key={id} itemId={id} open={id === shown} onToggle={() => toggle(id)} />)}
                {canEdit && !adding && <button type="button" class="add-mod" title="Add a mod" onClick={() => setAdding(true)}>＋</button>}
            </div>
            {adding
                ? <AddMod order={order} onAdded={id => { setAdding(false); setOpen(id); }} onClose={() => setAdding(false)} />
                : shown && <ModDetails key={shown} itemId={shown} />}
        </Scope>
    );
}
