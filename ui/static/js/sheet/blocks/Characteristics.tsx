// Characteristics: the computed values, which roll a test on a click of
// their label, and the dropdown with the permanent values and Conditions.
// The same parts open from the sheet's controls on every tab.
import type { SheetSignals } from "../schema/sheet";
import { useRef } from "preact/hooks";
import { useDropdown } from "../components/Dropdown";
import { ReadonlyField, TextField } from "../components/fields";
import { hoverTitle } from "../components/hoverTitle";
import { characteristicSummary, unnaturalSummary } from "../state/characteristicSummary";
import { peekAt } from "../state/sync";
import { Scope } from "../components/Scope";
import { bonusSuccessesOf, type SheetRolls } from "../rollEvents";
import { Conditions } from "./Conditions";
import { useSheet } from "../components/context";

type PermField = "value" | "unnatural";
type PermRef = (key: string, field: PermField) => (el: HTMLInputElement | null) => void;

function Label({ keyName, name, onClick }: { keyName: string; name: string; onClick?: () => void }) {
    return <label class={onClick ? "rollable" : undefined} onClick={onClick}>{name}<br />({keyName})</label>;
}

export function rollCharacteristic({ state, rolls }: { state: SheetSignals; rolls: SheetRolls }, key: string, name: string): void {
    const target = Number(peekAt(state, `characteristics.${key}.valueForRolls`));
    if (Number.isNaN(target)) return;
    void rolls.versus(target, bonusSuccessesOf(state, key), name);
}

/** A click on a computed value opens the dropdown at the permanent value behind it. */
function usePermanentFocus(show: () => void): { edit: (key: string, field: PermField) => void; permRef: PermRef } {
    const inputs = useRef<{ [key: string]: { [F in PermField]?: HTMLInputElement | null } }>({});
    return {
        edit: (key, field) => {
            show();
            setTimeout(() => inputs.current[key]?.[field]?.focus(), 0);
        },
        permRef: (key, field) => el => {
            inputs.current[key] = { ...inputs.current[key], [field]: el };
        },
    };
}

function CalculatedCharacteristics({ onEdit }: { onEdit: (key: string, field: PermField) => void }) {
    const sheet = useSheet();
    return (
        <Scope dataId="characteristics" class="layout-row main-characteristics">
            {sheet.stats.characteristics.map(({ key, label: name }) => (
                <Scope key={key} dataId={key} class="characteristic-block">
                    <Label keyName={key} name={name} onClick={() => rollCharacteristic(sheet, key, name)} />
                    <div class="characteristic-field">
                        <ReadonlyField field="calculatedValue" class="attribute textlike" onClick={() => onEdit(key, "value")}
                            {...hoverTitle(() => characteristicSummary(sheet.state, key))} />
                        <ReadonlyField field="calculatedUnnatural" class="attribute-unnatural textlike" maxLength={2}
                            onClick={() => onEdit(key, "unnatural")} {...hoverTitle(() => unnaturalSummary(sheet.state, key))} />
                    </div>
                </Scope>
            ))}
        </Scope>
    );
}

function PermanentCharacteristics({ permRef }: { permRef: PermRef }) {
    const { stats } = useSheet();
    return (
        <Scope dataId="characteristics" class="perm-temp-section">
            <h4>Permanent</h4>
            <div class="layout-row">
                {stats.characteristics.map(({ key, label: name }) => (
                    <Scope key={key} dataId={key} class="characteristic-block">
                        <Label keyName={key} name={name} />
                        <div class="characteristic-field">
                            <TextField field="value" class="attribute" inputRef={permRef(key, "value")} />
                            <TextField field="unnatural" class="attribute-unnatural" maxLength={2}
                                inputRef={permRef(key, "unnatural")} />
                        </div>
                    </Scope>
                ))}
            </div>
        </Scope>
    );
}

export function Characteristics() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const { edit, permRef } = usePermanentFocus(dropdown.show);

    return (
        <div class="characteristics" ref={ref}>
            <h3>
                Characteristics{" "}
                <button
                    class={dropdown.open ? "char-dropdown-toggle active" : "char-dropdown-toggle"}
                    type="button"
                    onClick={dropdown.toggle}
                >
                    {dropdown.open ? "▲" : "▼"}
                </button>
            </h3>

            <CalculatedCharacteristics onEdit={edit} />

            <div class={dropdown.open ? "characteristics-dropdown visible" : "characteristics-dropdown"}>
                <div class="layout-column">
                    <PermanentCharacteristics permRef={permRef} />
                    <Conditions />
                </div>
            </div>
        </div>
    );
}

/**
 * The computed and permanent characteristics with Conditions behind a button
 * of the sheet's controls, on whatever tab is open. Rendered only while
 * open: it doubles the fields of the Player Sheet tab, which stay mounted.
 */
export function ConditionsControl() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const { edit, permRef } = usePermanentFocus(dropdown.show);

    return (
        <div class="conditions-control" ref={ref}>
            <button
                class={dropdown.open ? "conditions-toggle active" : "conditions-toggle"}
                type="button"
                title="Characteristics and conditions"
                onClick={dropdown.toggle}
            >
                {dropdown.open ? "Close Stats" : "Open Stats"}
            </button>
            {dropdown.open && (
                <div class="controls-dropdown conditions-dropdown layout-column">
                    <h4>Total</h4>
                    <CalculatedCharacteristics onEdit={edit} />
                    <PermanentCharacteristics permRef={permRef} />
                    <Conditions />
                </div>
            )}
        </div>
    );
}
