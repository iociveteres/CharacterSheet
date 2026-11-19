// Entries of a condition, gear item, armour mod or implant: what it adds to
// characteristics, rolls, skills, initiative, movement and armour
// (kinds/computed.ts reads them). Below the topics: conditions and gear both
// edit their entries with it.
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { nanoid } from "nanoid";
import { useItemIds } from "../components/useItemIds";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, Select, TextField } from "../components/fields";
import { valueAt } from "../core/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, filterGroups, useQueryAtCaret } from "../components/SuggestField";
import { TextMarks } from "../components/TextMarks";
import { AP_TYPES, ENTRY_TYPES, ROLL_DOMAINS, ROLL_DOMAIN_MODES, ROLL_DOMAIN_MODES_TITLE, WEAPON_FIELDS, type Characteristic } from "../schema/constants";
import { THIS_ITEM, WEAPON_GROUPS, WEAPON_KINDS, WEAPON_PROFILES, unknownWeaponWords, weaponNames } from "../modifiers/weaponWords";
import { anyScope, characteristicSuggestions, insertToken, tokenAt } from "../characteristics/characteristicSuggestions";
import { characteristicsOf } from "../modifiers/entries";
import { namesSheetSkill, skillNameGroups } from "../characteristics/skillNames";
import { t } from "../../i18n";

/** Types whose entry names a characteristic or a skill. */
const NAMED_TYPES = new Set(["char_bonus", "char_cap", "char_cap_bonus", "char_override", "roll_bonus", "skill_bonus", "weapon_bonus"]);

function ValueField({ field, label }: { field: string; label: string }) {
    return (
        <span class="field-stack">
            <span class="field-label">{label}</span>
            <TextField field={field} class="textlike" placeholder={t("sheet.entries.valuePlaceholder")} />
        </span>
    );
}

/** The value fields of an entry of `type`, in the groups sheet.css lays out. */
function EntryValues({ type }: { type: string }) {
    switch (type) {
        case "char_bonus":
            return (
                <span class="value-char-bonus entry-field-group">
                    <ValueField field="bonus" label={t("sheet.entries.char")} />
                    <ValueField field="unnaturalBonus" label={t("sheet.entries.unnatural")} />
                </span>
            );
        case "char_cap":
            return <span class="value-char-cap entry-field-group"><ValueField field="cap" label={t("sheet.entries.char")} /></span>;
        case "char_cap_bonus":
            return (
                <span class="value-char-cap-bonus entry-field-group"
                    title={t("sheet.entries.capBonusTitle")}>
                    <ValueField field="capBonus" label={t("common.bonus")} />
                </span>
            );
        case "char_override":
            return (
                <span class="value-char-override entry-field-group">
                    <ValueField field="overrideValue" label={t("sheet.entries.value")} />
                    <ValueField field="overrideUnnatural" label={t("sheet.entries.unnatural")} />
                </span>
            );
        case "roll_bonus":
            return <span class="value-roll-bonus entry-field-group"><ValueField field="rollBonus" label={t("sheet.entries.char")} /></span>;
        case "skill_bonus":
            return <span class="value-skill-bonus entry-field-group"><ValueField field="skillBonus" label={t("sheet.entries.char")} /></span>;
        case "ablative_wounds":
            return <span class="value-ablative entry-field-group"><ValueField field="ablativeWounds" label={t("sheet.terms.stat.wounds")} /></span>;
        case "initiative_bonus":
            return (
                <span class="value-initiative-bonus entry-field-group">
                    <ValueField field="initiativeBonus" label={t("sheet.entries.initiative")} />
                </span>
            );
        case "movement_bonus":
            return (
                <span class="value-movement-bonus entry-field-group">
                    <ValueField field="movementBonus" label={t("sheet.entries.movement")} />
                </span>
            );
        case "weapon_bonus":
            return (
                <span class="value-weapon-bonus entry-field-group">
                    <span class="field-stack">
                        <span class="field-label">{t("sheet.entries.weaponField")}</span>
                        <Select field="weaponField" class="textlike" options={WEAPON_FIELDS}
                            title={t("sheet.entries.weaponFieldTitle")} />
                    </span>
                    <ValueField field="weaponBonus" label={t("sheet.entries.value")} />
                </span>
            );
        case "bonus_ap":
            return (
                <span class="value-bonus-ap entry-field-group">
                    <span class="field-stack">
                        <span class="field-label">{t("sheet.entries.apType")}</span>
                        <Select field="apType" class="textlike" options={AP_TYPES} />
                    </span>
                    <ValueField field="apValue" label={t("sheet.entries.ap")} />
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

const characteristicsTitle = (characteristics: readonly Characteristic[]) =>
    t("sheet.entries.characteristicsTitle", { any: anyScope(characteristics) });

/**
 * The characteristics an entry counts on, with suggestions for the token being
 * typed. While a token names none (modifiers/entryValues.ts parseCharacteristics), the field
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
                placeholder={t("sheet.entries.characteristicsPlaceholder")}
                title={invalid.length ? `${t("sheet.entries.unknown", { words: invalid.join(", ") })}\n\n${title}` : title}
                suggest={(query, text) => characteristicSuggestions(stats.characteristics, text, query)}
                queryAt={tokenAt} insert={insertToken} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={parts} />}
        </>
    );
}

// The words are the ones the entry is written in, the same in every language (modifiers/weaponWords.ts).
const WEAPONS_TITLE = t("sheet.entries.weaponsTitle");

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

const THIS_ITEM_TITLE = t("sheet.entries.thisItemTitle", { word: THIS_ITEM });

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
        ...(inItem ? [{ label: t("sheet.entries.group.item"), options: [{ value: THIS_ITEM, label: t("sheet.entries.thisItem") }] }] : []),
        { label: t("sheet.entries.group.all"), options: WEAPON_KINDS },
        { label: t("sheet.entries.group.groups"), options: WEAPON_GROUPS },
        { label: t("sheet.entries.group.profiles"), options: WEAPON_PROFILES },
        { label: t("sheet.entries.group.weapons"), options: weaponNames(state) },
    ];
    // The word being typed may still become one.
    const unfinished = typing !== null && typing !== "" && filterGroups(groups(), typing).length > 0;
    const invalid = unknownWeaponWords(state, name, inItem).filter(w => !(unfinished && w === typing?.toLowerCase()));
    return (
        <SuggestField inputRef={inputRef} field="name" class={invalid.length ? "textlike entry-name invalid" : "textlike entry-name"}
            placeholder={inItem ? t("sheet.entries.weaponsPlaceholderInItem", { word: THIS_ITEM }) : t("sheet.entries.weaponsPlaceholder")}
            title={invalid.length ? `${t("sheet.entries.unknown", { words: invalid.join(", ") })}\n\n${title}` : title}
            suggest={query => filterGroups(groups(), query)} queryAt={wordAt} insert={insertWord} />
    );
}

const UNMATCHED_SKILL_TITLE = t("sheet.entries.unmatchedSkill");

/** The skill of a skill bonus, picked from the skills of the sheet or typed, dashed while no skill goes by it. */
function SkillNameField({ path }: { path: string }) {
    const { state, stats } = useSheet();
    // A computed of the answer alone: typing a skill's name renders none of the entries unless it changes.
    const unmatched = useComputed(() => {
        const name = String(valueAt(state, `${path}.name`) ?? "").trim();
        return name !== "" && !namesSheetSkill(state, name);
    }).value;
    return (
        <SuggestField field="name" class={unmatched ? "textlike entry-name unmatched" : "textlike entry-name"}
            placeholder={t("sheet.entries.skillName")} title={unmatched ? UNMATCHED_SKILL_TITLE : undefined}
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
    return <button type="button" class="add-first-condition" onClick={addFirst}>{t("sheet.entries.addCondition")}</button>;
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
            <legend>{t("sheet.terms.block.conditions")}</legend>
            <ConditionEntries itemId={itemId} />
        </fieldset>
    );
}
