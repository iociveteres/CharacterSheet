// Entries of a condition, gear item, armour mod or implant: what it adds to
// characteristics, rolls, skills, initiative, movement and armour
// (state/computed.js reads them).
import { useRef } from "preact/hooks";
import { nanoid } from "nanoid";
import { useItemIds } from "../components/useItemIds";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, Select, TextField } from "../components/fields";
import { valueAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, filterGroups, useQueryAtCaret } from "../components/SuggestField";
import { TextMarks } from "../components/TextMarks";
import { AP_TYPES, ENTRY_TYPES, ROLL_DOMAINS, ROLL_DOMAIN_MODES, ROLL_DOMAIN_MODES_TITLE, WEAPON_FIELDS, type Characteristic } from "../schema/constants";
import { THIS_ITEM, WEAPON_GROUPS, WEAPON_KINDS, WEAPON_PROFILES, unknownWeaponWords, weaponNames } from "../state/weaponBonus";
import { anyScope, characteristicSuggestions, insertToken, tokenAt } from "../state/characteristicSuggestions";
import { characteristicsOf } from "../state/computed";
import { namesSheetSkill, skillNameGroups } from "../state/skillNames";

/** Types whose entry names a characteristic or a skill. */
const NAMED_TYPES = new Set(["char_bonus", "char_cap", "char_cap_bonus", "char_override", "roll_bonus", "skill_bonus", "weapon_bonus"]);

function ValueField({ field, label }: { field: string; label: string }) {
    return (
        <span class="field-stack">
            <span class="field-label">{label}</span>
            <TextField field={field} class="textlike" placeholder="0 or X" />
        </span>
    );
}

/** The value fields of an entry of `type`, in the groups sheet.css lays out. */
function EntryValues({ type }: { type: string }) {
    switch (type) {
        case "char_bonus":
            return (
                <span class="value-char-bonus entry-field-group">
                    <ValueField field="bonus" label="Char." />
                    <ValueField field="unnaturalBonus" label="Unnat." />
                </span>
            );
        case "char_cap":
            return <span class="value-char-cap entry-field-group"><ValueField field="cap" label="Char." /></span>;
        case "char_cap_bonus":
            return (
                <span class="value-char-cap-bonus entry-field-group"
                    title="Raises the caps of these characteristics: inside a gear item only that item's caps, elsewhere all of them">
                    <ValueField field="capBonus" label="Bonus" />
                </span>
            );
        case "char_override":
            return (
                <span class="value-char-override entry-field-group">
                    <ValueField field="overrideValue" label="Value" />
                    <ValueField field="overrideUnnatural" label="Unnat." />
                </span>
            );
        case "roll_bonus":
            return <span class="value-roll-bonus entry-field-group"><ValueField field="rollBonus" label="Char." /></span>;
        case "skill_bonus":
            return <span class="value-skill-bonus entry-field-group"><ValueField field="skillBonus" label="Char." /></span>;
        case "ablative_wounds":
            return <span class="value-ablative entry-field-group"><ValueField field="ablativeWounds" label="Wounds" /></span>;
        case "initiative_bonus":
            return (
                <span class="value-initiative-bonus entry-field-group">
                    <ValueField field="initiativeBonus" label="Init." />
                </span>
            );
        case "movement_bonus":
            return (
                <span class="value-movement-bonus entry-field-group">
                    <ValueField field="movementBonus" label="Move" />
                </span>
            );
        case "weapon_bonus":
            return (
                <span class="value-weapon-bonus entry-field-group">
                    <span class="field-stack">
                        <span class="field-label">Field</span>
                        <Select field="weaponField" class="textlike" options={WEAPON_FIELDS}
                            title="The field of the weapons it adds to; Rng both ends of a melee range, Rng min and max one" />
                    </span>
                    <ValueField field="weaponBonus" label="Value" />
                </span>
            );
        case "bonus_ap":
            return (
                <span class="value-bonus-ap entry-field-group">
                    <span class="field-stack">
                        <span class="field-label">AP Type</span>
                        <Select field="apType" class="textlike" options={AP_TYPES} />
                    </span>
                    <ValueField field="apValue" label="AP" />
                </span>
            );
        default:
            return null;
    }
}

/** The rolls a roll bonus counts in: all, only the ticked ones or all except them. */
function RollDomains({ mode }: { mode: string }) {
    return (
        <span class={mode ? `entry-domains ${mode}` : "entry-domains"}>
            <Select field="domainMode" class="domain-mode" options={ROLL_DOMAIN_MODES} title={ROLL_DOMAIN_MODES_TITLE} />
            {mode && (
                <Scope as="span" dataId="domains" class="entry-domain-list">
                    {ROLL_DOMAINS.map(({ value, label, title }) => (
                        <label key={value} class="domain-chip" title={title}><Checkbox field={value} />{label}</label>
                    ))}
                </Scope>
            )}
        </span>
    );
}

const characteristicsTitle = (characteristics: readonly Characteristic[]) => [
    "The characteristics the entry applies to:",
    "WS — one characteristic",
    "WS, BS — several, separated by commas or spaces",
    `Any — ${anyScope(characteristics)}`,
    "Any -T — all but T; -T alone means the same",
    "Case does not matter. An unknown name turns the entry off.",
].join("\n");

/**
 * The characteristics an entry counts on, with suggestions for the token being
 * typed. While a token names none (system.ts parseCharacteristics), the field
 * is outlined and that token marked; not the token being typed while it may
 * still become a name, e.g. "An" of Any.
 */
function CharacteristicsField({ path }: { path: string }) {
    const { state, stats } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const name = String(valueAt(state, `${path}.name`) ?? "");
    const typing = useQueryAtCaret(inputRef, tokenAt);
    const unfinished = typing !== null && characteristicSuggestions(stats.characteristics, "", typing).length > 0;
    const invalid = characteristicsOf(state, name).invalid.filter(t => !(unfinished && t === typing));
    // Split at the separators of parseCharacteristics, kept as the odd parts.
    const parts = name.split(/([\s,]+)/).map((text, i) => ({ text, marked: i % 2 === 0 && invalid.includes(text) }));
    const title = characteristicsTitle(stats.characteristics);
    return (
        <>
            <SuggestField inputRef={inputRef} field="name" class={invalid.length ? "textlike entry-name invalid" : "textlike entry-name"}
                placeholder="WS, BS or Any -T"
                title={invalid.length ? `Unknown: ${invalid.join(", ")}. The entry is off.\n\n${title}` : title}
                suggest={(query, text) => characteristicSuggestions(stats.characteristics, text, query)}
                queryAt={tokenAt} insert={insertToken} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={parts} />}
        </>
    );
}

const WEAPONS_TITLE = [
    "The weapons the entry adds to, separated by commas:",
    "Melee, Ranged — all of a kind",
    "Primary, Power, Pistol — a melee group or ranged class",
    "sword, spear — a melee profile",
    "Longsword — a weapon of the sheet by its name",
    "Case does not matter. An unknown word turns the entry off.",
].join("\n");

/** The word of a comma-separated list at `caret`, trimmed. */
const wordAt = (text: string, caret: number) => {
    const start = text.lastIndexOf(",", caret - 1) + 1;
    const end = text.indexOf(",", caret);
    return text.slice(start, end < 0 ? text.length : end).trim();
};

/** `text` with `value` for the word at `caret`; before the player typed, added as a new word. */
function insertWord(text: string, caret: number, value: string, typed: boolean): string {
    if (!typed) {
        const rest = text.replace(/[\s,]+$/, "");
        return rest ? `${rest}, ${value}` : value;
    }
    const start = text.lastIndexOf(",", caret - 1) + 1;
    const end = text.indexOf(",", caret);
    return `${text.slice(0, start)}${start > 0 ? " " : ""}${value}${end < 0 ? "" : text.slice(end)}`;
}

const THIS_ITEM_TITLE = `${THIS_ITEM} — the attacks linked to this gear item, equipped or not`;

/**
 * The weapons a weapon entry adds to, with suggestions: the kinds, groups,
 * profiles and the sheet's weapons; inside a gear item also This item.
 */
function WeaponsField({ path }: { path: string }) {
    const { state } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const name = String(valueAt(state, `${path}.name`) ?? "");
    const typing = useQueryAtCaret(inputRef, wordAt);
    // The item's own entries and those of its material, mods and enchantments are all under it.
    const inItem = path.startsWith("gear.list.items.");
    const title = inItem ? `${WEAPONS_TITLE}\n${THIS_ITEM_TITLE}` : WEAPONS_TITLE;
    const groups = () => [
        ...(inItem ? [{ label: "Item", options: [THIS_ITEM] }] : []),
        { label: "All", options: WEAPON_KINDS },
        { label: "Groups", options: WEAPON_GROUPS },
        { label: "Profiles", options: WEAPON_PROFILES },
        { label: "Weapons", options: weaponNames(state) },
    ];
    // The word being typed may still become one.
    const unfinished = typing !== null && typing !== "" && filterGroups(groups(), typing).length > 0;
    const invalid = unknownWeaponWords(state, name, inItem).filter(w => !(unfinished && w === typing?.toLowerCase()));
    return (
        <SuggestField inputRef={inputRef} field="name" class={invalid.length ? "textlike entry-name invalid" : "textlike entry-name"}
            placeholder={inItem ? "This item, Melee…" : "Melee, sword, a weapon…"}
            title={invalid.length ? `Unknown: ${invalid.join(", ")}. The entry is off.\n\n${title}` : title}
            suggest={query => filterGroups(groups(), query)} queryAt={wordAt} insert={insertWord} />
    );
}

const UNMATCHED_SKILL_TITLE = "No skill of this name on the sheet yet: the bonus counts once there is one.";

/** The skill of a skill bonus, picked from the skills of the sheet or typed, dashed while no skill goes by it. */
function SkillNameField({ path }: { path: string }) {
    const { state, stats } = useSheet();
    const name = String(valueAt(state, `${path}.name`) ?? "").trim();
    const unmatched = name !== "" && !namesSheetSkill(state, stats, name);
    return (
        <SuggestField field="name" class={unmatched ? "textlike entry-name unmatched" : "textlike entry-name"}
            placeholder="Skill name" title={unmatched ? UNMATCHED_SKILL_TITLE : undefined}
            suggest={query => filterGroups(skillNameGroups(state, stats), query)} />
    );
}

export function ConditionEntry({ itemId }: { itemId: string }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const type = String(valueAt(state, `${path}.type`) ?? "");
    const domainMode = type === "roll_bonus" ? String(valueAt(state, `${path}.domainMode`) ?? "") : "";
    return (
        <Scope dataId={itemId} class="condition-entry">
            <Select field="type" class="entry-type" options={ENTRY_TYPES} />
            {NAMED_TYPES.has(type) && (
                <span class="entry-name-wrap">
                    {type === "skill_bonus"
                        ? <SkillNameField path={path} />
                        : type === "weapon_bonus" ? <WeaponsField path={path} /> : <CharacteristicsField path={path} />}
                </span>
            )}
            {/* A new type gets new inputs rather than the old ones with other data-ids. */}
            <EntryValues key={type} type={type} />
            <DragHandle />
            <DeleteButton itemPath={path} />
            {type === "roll_bonus" && <RollDomains mode={domainMode} />}
        </Scope>
    );
}

/**
 * The entries grid of the item at the enclosing path. New entry ids start
 * with `entries-<itemId>`, as the old grid named them.
 */
export function ConditionEntries({ itemId }: { itemId: string }) {
    return (
        <ItemGrid
            dataId="entries.items"
            class="condition-entries"
            itemClass="condition-entry"
            idPrefix={`entries-${itemId}`}
            renderItem={id => <ConditionEntry itemId={id} />}
        />
    );
}

/** ＋ condition of the item `itemId` at `itemPath` without entries, alone or in a gear item's add line. */
export function AddConditionButton({ itemId, itemPath }: { itemId: string; itemPath: string }) {
    const { actions } = useSheet();
    const gridPath = `${itemPath}.entries.items`;
    const addFirst = () => actions.createItem(gridPath, `entries-${itemId}-${nanoid()}`, {}, { colIndex: 0, rowIndex: 0 });
    return <button type="button" class="add-first-condition" onClick={addFirst}>＋ condition</button>;
}

/**
 * The entries of the gear item, implant or armour mod at `itemPath`: a stub
 * button adds the first one, unless `addButton` is false (a gear item has it
 * in its add line), then the grid shows, in a Conditions fieldset unless
 * `framed` is false.
 */
export function ItemEntries({ itemId, itemPath, framed = true, addButton = true }: {
    itemId: string; itemPath: string; framed?: boolean; addButton?: boolean;
}) {
    const { canEdit } = useSheet();
    const { ids } = useItemIds(`${itemPath}.entries.items`);
    if (ids.length === 0) return canEdit && addButton ? <AddConditionButton itemId={itemId} itemPath={itemPath} /> : null;
    if (!framed) return <ConditionEntries itemId={itemId} />;
    return (
        <fieldset class="gear-condition-fields">
            <legend>Conditions</legend>
            <ConditionEntries itemId={itemId} />
        </fieldset>
    );
}
