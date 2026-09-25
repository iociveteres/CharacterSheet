// Parts of the roll dropdowns of attacks, powers and the compensation roll:
// radio columns of modifiers, the two extra modifiers and the result with
// its Roll button. The dropdown opens from the item's name label.
import type { ComponentChildren } from "preact";
import { Signal, type ReadonlySignal } from "@preact/signals-core";
import { Checkbox, NumberField, RadioGroup, ReadonlyField, Select, TextField, peekAt, valueAt } from "../components/fields";
import { modifierField, type Option, type RollColumn } from "../schema/constants";
import { Scope } from "../components/Scope";
import { rollExact, rollVersus } from "../rollEvents";
import { getRollValue, rollBonusSuccesses } from "../state/rollBase.js";
import { resolvePath } from "../state/sync.js";

// The totals of the rolls. Only its roll dropdown shows a total and rolls it,
// so the dropdown computes it (useComputed) from the fields under the roll.

const num = (path: string) => Number(valueAt(path)) || 0;

const extra = (rollPath: string, n: 1 | 2) => (valueAt(`${rollPath}.extra${n}.enabled`) ? num(`${rollPath}.extra${n}.value`) : 0);

/** The value of the base select's characteristic or skill, plus the enabled extras. */
const baseAndExtras = (rollPath: string) =>
    getRollValue(String(valueAt(`${rollPath}.baseSelect`) ?? "")) + extra(rollPath, 1) + extra(rollPath, 2);

/** The modifier of the option selected in `column`, the column default's when none or no known one is. */
function selectedModifier(rollPath: string, column: RollColumn): number {
    const colPath = `${rollPath}.${column.key}`;
    const selected = String(valueAt(`${colPath}.selected`) || column.default);
    const known = resolvePath(`${colPath}.${modifierField(selected)}`) instanceof Signal;
    return num(`${colPath}.${modifierField(known ? selected : column.default)}`);
}

/** An attack: the modifiers selected in its columns. */
export const attackTotal = (rollPath: string, columns: readonly RollColumn[]) =>
    baseAndExtras(rollPath) + columns.reduce((sum, column) => sum + selectedModifier(rollPath, column), 0);

/** A psychic power: the modifier and 5 per effective and kicked PR. */
export const psychicTotal = (rollPath: string) =>
    baseAndExtras(rollPath) + num(`${rollPath}.modifier`) + 5 * num(`${rollPath}.effectivePR`) + 5 * num(`${rollPath}.kickPR`);

export const techTotal = (rollPath: string) => baseAndExtras(rollPath) + num(`${rollPath}.modifier`);

/** The compensation roll of techno arcana: T − 10 × X, plus the enabled extras. */
export const compensationTotal = (rollPath: string) =>
    num("characteristics.T.valueForRolls") - 10 * num(`${rollPath}.modifier`) + extra(rollPath, 1) + extra(rollPath, 2);

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
export function extraNames(rollPath: string): string[] {
    return [1, 2]
        .filter(n => peekAt(`${rollPath}.extra${n}.enabled`) && peekAt(`${rollPath}.extra${n}.name`))
        .map(n => String(peekAt(`${rollPath}.extra${n}.name`)));
}

/** Names of the non-default options selected in the columns, for the roll label. */
export function selectedNames(rollPath: string, columns: readonly RollColumn[]): string[] {
    const out: string[] = [];
    for (const { key, default: def, names } of columns) {
        const selected = String(peekAt(`${rollPath}.${key}.selected`) ?? "");
        if (!selected || selected === def) continue;
        out.push(names?.[selected] ?? selected);
    }
    return out;
}

/** `name, modifier, modifier` or just the name. */
export const rollLabel = (name: string, modifiers: string[]) => (modifiers.length ? `${name}, ${modifiers.join(", ")}` : name);

/** Rolls `total`, with the bonus successes of the characteristic or skill of the roll's base select. */
export function rollTotal(rollPath: string, total: number, label: string, bonusSuccesses?: number): void {
    const bonus = bonusSuccesses ?? rollBonusSuccesses(String(peekAt(`${rollPath}.baseSelect`) ?? ""));
    rollVersus(total, bonus, label);
}

/** The base select of a roll: characteristics and skills it can be tested on. */
export function BaseSelect({ options }: { options: readonly Option[] }) {
    return <Select field="baseSelect" options={options} />;
}

export function RollResult({ total, onRoll, children }: { total: ReadonlySignal<number>; onRoll: () => void; children?: ComponentChildren }) {
    return (
        <div class="roll-result">
            {children}
            <ReadonlyField field="total" value={total} type="number" class="textlike" />
            <button data-id="rollButton" onClick={onRoll}>Roll</button>
        </div>
    );
}

/** The name label that opens the roll dropdown. */
export function RollToggleLabel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    return <label class={open ? "rollable active" : "rollable"} onClick={onToggle}>Name:</label>;
}

/** A damage label that rolls the damage expression of the field next to it. */
export function DamageLabel({ damagePath, label, children = "Damage:" }: { damagePath: string; label: () => string; children?: ComponentChildren }) {
    const roll = () => {
        const expression = String(peekAt(damagePath) ?? "").trim();
        if (expression) rollExact(expression, label());
    };
    return <label class="rollable" onClick={roll}>{children}</label>;
}
