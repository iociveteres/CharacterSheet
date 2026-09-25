// Parts of the roll dropdowns of attacks, powers and the compensation roll:
// radio columns of modifiers, the two extra modifiers and the result with
// its Roll button. The dropdown opens from the item's name label.
import type { ComponentChildren } from "preact";
import { Checkbox, NumberField, RadioGroup, ReadonlyField, Select, TextField, peekAt, type Option } from "../components/fields";
import { Scope } from "../components/Scope";
import { rollExact, rollVersus } from "../rollEvents";
import { rollBonusSuccesses } from "../state/rollBase.js";

/** One option of a radio column: its value, the field of its modifier and its label. */
export type ColumnOption = readonly [value: string, field: string, label: string];

/** A column of modifiers of which the selected one counts, e.g. aim or range. */
export function RadioColumn({ dataId, label, options }: { dataId: string; label: string; options: readonly ColumnOption[] }) {
    const fields = new Map(options.map(([value, field]) => [value, field]));
    return (
        <Scope dataId={dataId} class={`roll-column ${dataId}`}>
            <label class="column-label">{label}</label>
            <div class="roll-column-content">
                <RadioGroup
                    field="selected"
                    options={options.map(([value, , text]) => ({ value, label: text }))}
                    renderOption={(radio, value, text) => (
                        <div class="radio-option">
                            <label>{radio}{text}</label>
                            <NumberField field={fields.get(value)!} />
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
export function selectedNames(rollPath: string, columns: { [column: string]: { default: string; names: { [value: string]: string } } }): string[] {
    const out: string[] = [];
    for (const [column, { default: def, names }] of Object.entries(columns)) {
        const selected = String(peekAt(`${rollPath}.${column}.selected`) ?? "");
        if (!selected || selected === def) continue;
        out.push(names[selected] ?? selected);
    }
    return out;
}

/** `name, modifier, modifier` or just the name. */
export const rollLabel = (name: string, modifiers: string[]) => (modifiers.length ? `${name}, ${modifiers.join(", ")}` : name);

/** Rolls the total of the roll at `rollPath` against the characteristic or skill of its base select. */
export function rollTotal(rollPath: string, label: string, bonusSuccesses?: number): void {
    const target = parseInt(String(peekAt(`${rollPath}.total`) ?? ""), 10) || 0;
    const bonus = bonusSuccesses ?? rollBonusSuccesses(String(peekAt(`${rollPath}.baseSelect`) ?? ""));
    rollVersus(target, bonus, label);
}

/** The base select of a roll: characteristics and skills it can be tested on. */
export function BaseSelect({ options }: { options: readonly Option[] }) {
    return <Select field="baseSelect" options={options} />;
}

export function RollResult({ onRoll, children }: { onRoll: () => void; children?: ComponentChildren }) {
    return (
        <div class="roll-result">
            {children}
            <ReadonlyField field="total" type="number" class="textlike" />
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
