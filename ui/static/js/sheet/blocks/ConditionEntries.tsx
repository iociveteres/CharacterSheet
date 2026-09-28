// Entries of a condition, gear item or implant: what it adds to
// characteristics, rolls, skills, initiative, movement and armour
// (state/computed.js reads them).
import { joinPath, usePath } from "../components/context";
import { Checkbox, Select, TextField, valueAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AP_TYPES, ENTRY_TYPES, ROLL_DOMAINS, ROLL_DOMAIN_MODES, ROLL_DOMAIN_MODES_TITLE } from "../schema/constants";

/** Types whose entry names a characteristic or a skill. */
const NAMED_TYPES = new Set(["char_bonus", "char_cap", "char_override", "roll_bonus", "skill_bonus"]);

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

function namePlaceholder(type: string, domainMode: string): string {
    if (type === "skill_bonus") return "Skill name";
    // state/computed.ts counts an unnamed "only" roll bonus on every characteristic.
    if (type === "roll_bonus" && domainMode === "only") return "Any characteristic";
    return "Characteristic (e.g. WS)";
}

export function ConditionEntry({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const type = String(valueAt(`${path}.type`) ?? "");
    const domainMode = type === "roll_bonus" ? String(valueAt(`${path}.domainMode`) ?? "") : "";
    return (
        <Scope dataId={itemId} class="condition-entry">
            <Select field="type" class="entry-type" options={ENTRY_TYPES} />
            {NAMED_TYPES.has(type) && (
                <span class="entry-name-wrap">
                    <TextField field="name" class="textlike entry-name" placeholder={namePlaceholder(type, domainMode)} />
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
