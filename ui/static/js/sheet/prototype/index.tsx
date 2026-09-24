// Dev-only prototype of Preact grids on the real sheet: Talents as a flat
// grid and Conditions with their nested entries. It replaces the old blocks
// when localStorage["sheet:preact-prototype"] is "1" in a watch build, so
// drag and drop can be tried with another player changing the grid. The
// Conditions pilot (stage 3) replaces it.
import type { VNode } from "preact";
import type { Signal } from "@preact/signals-core";
import { resolvePath } from "../state/sync.js";
import { joinPath, usePath, type AutocompleteResult } from "../components/context";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { Checkbox, NumberField, Select, TextArea, TextField } from "../components/fields";
import { ItemGrid } from "../components/ItemGrid";
import { mountBlock } from "../components/mount";
import { Scope } from "../components/Scope";
import { AutocompleteAnchor, useAutocomplete } from "../components/useAutocomplete";

const FLAG = "sheet:preact-prototype";

export function prototypeEnabled(): boolean {
    try {
        return localStorage.getItem(FLAG) === "1";
    } catch {
        return false;
    }
}

const text = (path: string) => String((resolvePath(path) as Signal<unknown> | null)?.value ?? "");

function talentOption(r: AutocompleteResult): string {
    const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
    return `<div class="ac-header"><span class="ac-name">${name}</span>${r.entryType ?? ""}</div>`;
}

function Talent({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => text(`${path}.description`).trim() !== "" });
    const { inputRef, anchorRef } = useAutocomplete(path, "talents", talentOption);
    return (
        <Scope dataId={itemId} class={collapsed ? "item-with-description collapsed" : "item-with-description"} elRef={elRef}>
            <div class="split-header">
                <TextField field="name" inputRef={inputRef} />
                <AutocompleteAnchor anchorRef={anchorRef} />
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

const ENTRY_TYPES = [
    { value: "char_bonus", label: "Char. Bonus" },
    { value: "char_cap", label: "Char. Cap" },
    { value: "char_override", label: "Char. Override" },
    { value: "roll_bonus", label: "Roll Bonus" },
    { value: "skill_bonus", label: "Skill Bonus" },
    { value: "ablative_wounds", label: "Ab. Wounds" },
    { value: "initiative_bonus", label: "Init. Bonus" },
    { value: "movement_bonus", label: "Move. Bonus" },
    { value: "bonus_ap", label: "Bonus AP" },
];

// Value fields of each entry type.
const ENTRY_FIELDS: { [type: string]: [field: string, label: string][] } = {
    char_bonus: [["bonus", "Char."], ["unnaturalBonus", "Unnat."]],
    char_cap: [["cap", "Char."]],
    char_override: [["overrideValue", "Value"], ["overrideUnnatural", "Unnat."]],
    roll_bonus: [["rollBonus", "Char."]],
    skill_bonus: [["skillBonus", "Char."]],
    ablative_wounds: [["ablativeWounds", "Wounds"]],
    initiative_bonus: [["initiativeBonus", "Init."]],
    movement_bonus: [["movementBonus", "Move"]],
    bonus_ap: [["apValue", "AP"]],
};

const NAMELESS = ["ablative_wounds", "initiative_bonus", "movement_bonus", "bonus_ap"];

function Entry({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const type = (resolvePath(`${path}.type`) as Signal<string> | null)?.value ?? "char_bonus";
    return (
        <Scope dataId={itemId} class="condition-entry">
            <Select field="type" class="entry-type" options={ENTRY_TYPES} />
            {!NAMELESS.includes(type) && (
                <span class="entry-name-wrap">
                    <TextField field="name" class="textlike entry-name"
                        placeholder={type === "skill_bonus" ? "Skill name" : "Characteristic (e.g. WS)"} />
                </span>
            )}
            <span class="entry-field-group">
                {(ENTRY_FIELDS[type] ?? []).map(([field, label]) => (
                    <span key={field} class="field-stack">
                        <span class="field-label">{label}</span>
                        <TextField field={field} class="textlike" placeholder="0 or X" />
                    </span>
                ))}
            </span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

function Condition({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => true });
    return (
        <Scope dataId={itemId} class={collapsed ? "condition-item collapsed" : "condition-item"} elRef={elRef}>
            <div class="split-header">
                <Checkbox field="enabled" class="custom" />
                <TextField field="name" class="long textlike" />
                <label>X:<NumberField field="stacks" class="short" min="0" title="Stack count — uses in place of X in entries" /></label>
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <ItemGrid dataId="entries.items" class="condition-entries" columns={1} itemClass="condition-entry"
                    idPrefix={`entries-${itemId}`} renderItem={id => <Entry itemId={id} />} />
            </div>
        </Scope>
    );
}

/** Replaces an old grid element with a mount point for a Preact block. */
function mountInstead(root: ShadowRoot, selector: string, block: VNode, paths: string[]): void {
    const old = root.querySelector(selector);
    if (!old) return;
    const mount = document.createElement("div");
    mount.style.display = "contents";
    old.replaceWith(mount);
    mountBlock(mount, block, { paths });
}

/** Mounts the prototype blocks instead of the old Talents and Conditions. */
export function mountPrototype(root: ShadowRoot): void {
    mountInstead(root, "#talents", (
        <ItemGrid dataId="talents.list.items" id="talents" columns={3} itemClass="item-with-description"
            renderItem={id => <Talent itemId={id} />} />
    ), ["talents"]);
    mountInstead(root, "#conditions", (
        <ItemGrid dataId="conditions.list.items" id="conditions" columns={2} columnClass="condition-column"
            itemClass="condition-item" renderItem={id => <Condition itemId={id} />} />
    ), ["conditions"]);
    console.info(`Preact prototype: Talents and Conditions are Preact blocks. localStorage.removeItem("${FLAG}") turns it off.`);
}
