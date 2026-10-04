// Parts of the roll dropdowns of attacks, powers and the compensation roll:
// radio columns of modifiers, the two extra modifiers and the result with
// its Roll button. The dropdown opens from the item's name label.
import type { SheetSignals } from "../schema/sheet";
import type { ComponentChildren } from "preact";
import { Signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import { Checkbox, NumberField, RadioGroup, ReadonlyField, Select, TextField } from "../components/fields";
import { modifierField, type Option, type RollColumn, type RollDomain } from "../schema/constants";
import { Scope } from "../components/Scope";
import type { SheetRolls } from "../rollEvents";
import { getRollValue, rollBonusSuccesses } from "../state/rollBase";
import { numberAt, peekAt, resolvePath, valueAt } from "../state/sync";
import { domainRollBonus } from "../state/computed";
import { statAt, type DamageOwner } from "../state/damage";
import { useSheet } from "../components/context";

// The totals of the rolls. Only its roll dropdown shows a total and rolls it,
// so the dropdown computes it (useComputed) from the fields under the roll.

const extra = (state: SheetSignals, rollPath: string, n: 1 | 2) => (valueAt(state, `${rollPath}.extra${n}.enabled`) ? numberAt(state, `${rollPath}.extra${n}.value`) : 0);

/**
 * The value of the characteristic or skill the roll is tested on (`base`, as
 * rollBase.ts reads it) in a roll of `domain`, plus the enabled extras.
 */
const baseAndExtras = (state: SheetSignals, rollPath: string, base: string, domain: RollDomain) =>
    getRollValue(state, base, domain) + extra(state, rollPath, 1) + extra(state, rollPath, 2);

/** The modifier of the option selected in `column`, the column default's when none or no known one is. */
function selectedModifier(state: SheetSignals, rollPath: string, column: RollColumn): number {
    const colPath = `${rollPath}.${column.key}`;
    const selected = String(valueAt(state, `${colPath}.selected`) || column.default);
    const known = resolvePath(state, `${colPath}.${modifierField(selected)}`) instanceof Signal;
    return numberAt(state, `${colPath}.${modifierField(known ? selected : column.default)}`);
}

/** An attack: its base select and the modifiers selected in its columns. */
export const attackTotal = (state: SheetSignals, rollPath: string, columns: readonly RollColumn[], domain: "ranged" | "melee") =>
    baseAndExtras(state, rollPath, String(valueAt(state, `${rollPath}.baseSelect`) ?? ""), domain)
    + columns.reduce((sum, column) => sum + selectedModifier(state, rollPath, column), 0);

/** A psychic power on `test`: the modifier and 5 per effective and kicked PR; a safe cast has no kick. */
export const psychicTotal = (state: SheetSignals, rollPath: string, test: string) =>
    baseAndExtras(state, rollPath, test, "psychic") + numberAt(state, `${rollPath}.modifier`) + 5 * numberAt(state, `${rollPath}.effectivePR`)
    + (valueAt(state, `${rollPath}.safe`) ? 0 : 5 * numberAt(state, `${rollPath}.kickPR`));

export const techTotal = (state: SheetSignals, rollPath: string, test: string) => baseAndExtras(state, rollPath, test, "techPower") + numberAt(state, `${rollPath}.modifier`);

/** The compensation roll of techno arcana: T − 10 × X, plus the enabled extras. */
export const compensationTotal = (state: SheetSignals, rollPath: string) =>
    numberAt(state, "characteristics.T.valueForRolls") + domainRollBonus(state, "T", "compensation") - 10 * numberAt(state, `${rollPath}.modifier`) + extra(state, rollPath, 1) + extra(state, rollPath, 2);

/** A column of modifiers of which the selected one counts, e.g. aim or range. */
export function RadioColumn({ column: { key, label, options } }: { column: RollColumn }) {
    return (
        <Scope dataId={key} class={`roll-column ${key}`}>
            <label class="column-label">{label}</label>
            <div class="roll-column-content">
                <RadioGroup
                    field="selected"
                    options={options}
                    renderOption={(radio, value, text) => (
                        <div class="radio-option">
                            <label>{radio}{text}</label>
                            <NumberField field={modifierField(value)} />
                        </div>
                    )}
                />
            </div>
        </Scope>
    );
}

export function ExtraModifier({ n }: { n: 1 | 2 }) {
    return (
        <Scope dataId={`extra${n}`} class="extra-modifier">
            <TextField field="name" placeholder={`Extra ${n}`} />
            <div class="roll-column-content">
                <NumberField field="value" placeholder="0" />
                <Checkbox field="enabled" class="custom" />
            </div>
        </Scope>
    );
}

/** The names of the enabled extra modifiers of the roll at `rollPath`, for the roll label. */
export function extraNames(state: SheetSignals, rollPath: string): string[] {
    return [1, 2]
        .filter(n => peekAt(state, `${rollPath}.extra${n}.enabled`) && peekAt(state, `${rollPath}.extra${n}.name`))
        .map(n => String(peekAt(state, `${rollPath}.extra${n}.name`)));
}

/** Names of the non-default options selected in the columns, for the roll label. */
export function selectedNames(state: SheetSignals, rollPath: string, columns: readonly RollColumn[]): string[] {
    const out: string[] = [];
    for (const { key, default: def, names } of columns) {
        const selected = String(peekAt(state, `${rollPath}.${key}.selected`) ?? "");
        if (!selected || selected === def) continue;
        out.push(names?.[selected] ?? selected);
    }
    return out;
}

/** `name, modifier, modifier` or just the name. */
export const rollLabel = (name: string, modifiers: string[]) => (modifiers.length ? `${name}, ${modifiers.join(", ")}` : name);

/**
 * Rolls `total`, by default with the bonus successes of the characteristic or
 * skill of the roll's base select; resolves with what the test came to.
 */
export function rollTotal({ state, rolls }: { state: SheetSignals; rolls: SheetRolls }, rollPath: string, total: number, label: string, bonusSuccesses?: number) {
    const bonus = bonusSuccesses ?? rollBonusSuccesses(state, String(peekAt(state, `${rollPath}.baseSelect`) ?? ""));
    return rolls.versus(total, bonus, label);
}

/** The base select of a roll: characteristics and skills it can be tested on. */
export function BaseSelect({ options }: { options: readonly Option[] }) {
    return <Select field="baseSelect" options={options} />;
}

export function RollResult({ total, onRoll, disabled = false, title, button = "Roll", children }: {
    total: ReadonlySignal<number>; onRoll: () => void; disabled?: boolean; title?: string; button?: string; children?: ComponentChildren;
}) {
    return (
        <div class="roll-result">
            {children}
            <ReadonlyField field="total" value={total} type="number" class="textlike" />
            <button data-id="rollButton" onClick={onRoll} disabled={disabled} title={title}>{button}</button>
        </div>
    );
}

/** The name label that opens the roll dropdown. */
export function RollToggleLabel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    return <label class={open ? "rollable active" : "rollable"} onClick={onToggle}>Name:</label>;
}

/** A damage label that rolls the damage of the item of `owner` at `itemPath` with its modifiers. */
export function DamageLabel({ owner, itemPath, label, children = "Damage:" }: {
    owner: DamageOwner; itemPath: string; label: () => string; children?: ComponentChildren;
}) {
    const { state, rolls, preview } = useSheet();
    if (preview) return <label>{children}</label>;
    const roll = () => {
        const { expression } = untracked(() => statAt(state, owner, itemPath, "damage"));
        if (expression) void rolls.exact(expression, label());
    };
    return <label class="rollable" onClick={roll}>{children}</label>;
}
