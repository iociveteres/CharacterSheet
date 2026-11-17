// The mods of a gear item's armour or weapon: a line of chips, and under it the
// details of the open mod or the line that adds one. Their weights and entries
// count in gearItem.ts (gearMods), weapon mods' weight factors in
// gear/materialRules.ts (weightFactors). The
// enchantments of Pathfinder Crusade are such a line too (Enchantments.tsx).
import type { ComponentChildren, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { nanoid } from "nanoid";
import { t } from "../../i18n";
import { AutocompleteDropdown, AutocompleteField, useAutocompleteInput } from "../components/AutocompleteField";
import { nameAndTypeOption } from "../components/autocompleteOptions";
import { columnsFromLayout, createAtEnd } from "../core/columns";
import { joinPath, usePath, useSheet, type AutocompleteResult } from "../components/context";
import { NumberField, TextArea } from "../components/fields";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { valueAt } from "../core/sync";
import { ItemEntries } from "../entries/ConditionEntries";
import type { Adding } from "../components/kindParts";

/** The chip of the item `itemId`: its text opens the details, ✖ deletes it in Delete Mode. */
function Chip({ itemId, open, deleteTitle, text, onToggle }: {
    itemId: string;
    open: boolean;
    deleteTitle: string;
    text?: (path: string) => string;
    onToggle: () => void;
}) {
    const { state, canEdit, actions } = useSheet();
    const path = joinPath(usePath(), itemId);
    const label = text ? text(path) : String(valueAt(state, `${path}.name`) ?? "").trim() || "—";
    return (
        <span class={open ? "mod-chip open" : "mod-chip"}>
            <button type="button" class="mod-chip-name" onClick={onToggle}>{label}</button>
            {canEdit && <button type="button" class="mod-delete" title={deleteTitle} onClick={() => actions.deleteItem(path)}>✖</button>}
        </span>
    );
}

interface ModsProps {
    /** The autocomplete collection of the book's mods. */
    collection: string;
    /** The mods have a weight (armour). */
    weight?: boolean;
    /** The mods have a factor of the item's own weight (weapon). */
    factor?: boolean;
    /** The mods have condition entries. */
    entries?: boolean;
}

function ModDetails({ itemId, collection, weight, factor, entries }: { itemId: string } & ModsProps) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="mod-details">
            <div class="mod-header">
                <AutocompleteField field="name" class="mod-name textlike" placeholder={t("common.name")} itemPath={path} collection={collection} />
                {weight && <NumberField field="weight" class="short textlike" placeholder={t("sheet.termsArms.weaponField.weight.short")} />}
                {weight && <span class="mod-unit">{t("sheet.gear.kg")}</span>}
                {factor && <span class="mod-unit" title={t("sheet.gear.mod.weightFactor")}>×</span>}
                {factor && <NumberField field="weightFactor" class="short textlike" placeholder="1" title={t("sheet.gear.mod.weightFactor")} />}
            </div>
            <TextArea field="description" class="mod-description" placeholder=" " />
            {entries && <ItemEntries itemId={itemId} itemPath={path} framed={false} />}
        </Scope>
    );
}

/**
 * The line that adds an item at the end of `order`: a pick lays the
 * collection's entry over it, Enter on a typed name adds one of that name.
 * Esc, or leaving it empty, closes it.
 */
function AddChip({ collection, placeholder, idPrefix, order, onAdded, onClose }: {
    collection: string;
    placeholder: string;
    idPrefix: string;
    order: string[];
    onAdded: (itemId: string) => void;
    onClose: () => void;
}) {
    const { autocomplete, actions } = useSheet();
    const gridPath = usePath();
    const inputRef = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => inputRef.current?.focus(), []);

    const add = (name: string): string => {
        const itemId = `${idPrefix}-${nanoid()}`;
        createAtEnd(actions, gridPath, [order], 0, itemId, { name });
        onAdded(itemId);
        return joinPath(gridPath, itemId);
    };
    const pick = (result: AutocompleteResult) => {
        autocomplete?.close();
        actions.autocompleteApply(add(result.name), collection, result.name);
    };
    useAutocompleteInput(inputRef, collection, pick);

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
            <input type="text" ref={inputRef} placeholder={placeholder} onKeyDown={onKeyDown}
                onBlur={e => { if (!e.currentTarget.value.trim()) onClose(); }} />
            {autocomplete && <AutocompleteDropdown autocomplete={autocomplete} inputRef={inputRef} renderOption={nameAndTypeOption} onPick={pick} />}
        </div>
    );
}

export interface ChipTitles {
    add: string;
    adding: string;
    delete: string;
}

interface ChipRowProps {
    /** The grid under the enclosing path. */
    dataId: string;
    class?: string;
    label: ComponentChildren;
    /** The autocomplete collection of the book's entries. */
    collection: string;
    /** The titles of its ＋ and ✖ and the placeholder of its add line. */
    titles: ChipTitles;
    /** The prefix of a new one's id. */
    idPrefix: string;
    /** The text of the chip of the one at `path`; its name by default. */
    chipText?: (path: string) => string;
    details: (itemId: string) => VNode;
}

/**
 * A line of chips of the grid `dataId` under the enclosing path; one is open
 * at a time. An empty one shows only while its add line is open.
 */
export function ChipRow({ dataId, class: cls, label, collection, titles, idPrefix, chipText, details, adding, setAdding }: ChipRowProps & Adding) {
    const { canEdit } = useSheet();
    const { ids, layouts } = useItemIds(joinPath(usePath(), dataId));
    const [open, setOpen] = useState<string | null>(null);
    if (ids.length === 0 && !(canEdit && adding)) return null;

    const order = columnsFromLayout(1, layouts, ids)[0];
    // A deleted one closes.
    const shown = !adding && open !== null && ids.includes(open) ? open : null;
    const toggle = (id: string) => {
        setAdding(false);
        setOpen(id === shown ? null : id);
    };

    return (
        <Scope dataId={dataId} class={cls ? `item-mods ${cls}` : "item-mods"}>
            <div class="mods-row">
                <span class="mods-label">{label}</span>
                {order.map(id => <Chip key={id} itemId={id} open={id === shown} deleteTitle={titles.delete} text={chipText} onToggle={() => toggle(id)} />)}
                {canEdit && !adding && <button type="button" class="add-mod" title={titles.add} onClick={() => setAdding(true)}>＋</button>}
            </div>
            {adding
                ? <AddChip collection={collection} placeholder={titles.adding} idPrefix={idPrefix} order={order}
                    onAdded={id => { setAdding(false); setOpen(id); }} onClose={() => setAdding(false)} />
                : shown && details(shown)}
        </Scope>
    );
}

const MOD_TITLES: ChipTitles = { add: t("sheet.gear.mod.add"), adding: t("sheet.gear.mod.adding"), delete: t("sheet.gear.mod.delete") };

/** The mods of the armour or weapon at the enclosing path. */
export function Mods({ adding, setAdding, ...props }: ModsProps & Adding) {
    return (
        <ChipRow dataId="mods.items" label={`${t("sheet.gear.mods")}:`} collection={props.collection} titles={MOD_TITLES} idPrefix="mod"
            adding={adding} setAdding={setAdding} details={id => <ModDetails key={id} itemId={id} {...props} />} />
    );
}
