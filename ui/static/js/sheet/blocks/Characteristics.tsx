// Characteristics: the computed values, which roll a test on a click of
// their label, and the dropdown with the permanent values and Conditions.
import { useRef } from "preact/hooks";
import { useDropdown } from "../components/Dropdown";
import { ReadonlyField, TextField, peekAt } from "../components/fields";
import { Scope } from "../components/Scope";
import { bonusSuccessesOf, rollVersus } from "../rollEvents";
import { Conditions } from "./Conditions";

const CHARACTERISTICS: readonly [string, string][] = [
    ["WS", "Weapon Skill"],
    ["BS", "Ballistic Skill"],
    ["S", "Strength"],
    ["T", "Toughness"],
    ["A", "Agility"],
    ["I", "Intellig."],
    ["P", "Perception"],
    ["W", "Willpower"],
    ["F", "Fellowship"],
    ["Inf", "Infamy"],
    ["Cor", "Corruption"],
];

function Label({ keyName, name, onClick }: { keyName: string; name: string; onClick?: () => void }) {
    return <label class={onClick ? "rollable" : undefined} onClick={onClick}>{name}<br />({keyName})</label>;
}

function roll(key: string, name: string): void {
    const target = Number(peekAt(`characteristics.${key}.calculatedValue`));
    if (Number.isNaN(target)) return;
    rollVersus(target, bonusSuccessesOf(key), name);
}

type PermInputs = { [key: string]: { value?: HTMLInputElement | null; unnatural?: HTMLInputElement | null } };

export function Characteristics() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const perm = useRef<PermInputs>({});

    // A click on a computed value opens the dropdown at the permanent value behind it.
    const edit = (key: string, field: "value" | "unnatural") => {
        dropdown.show();
        setTimeout(() => perm.current[key]?.[field]?.focus(), 0);
    };
    const permRef = (key: string, field: "value" | "unnatural") => (el: HTMLInputElement | null) => {
        perm.current[key] = { ...perm.current[key], [field]: el };
    };

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

            <Scope dataId="characteristics" class="layout-row main-characteristics">
                {CHARACTERISTICS.map(([key, name]) => (
                    <Scope key={key} dataId={key} class="characteristic-block">
                        <Label keyName={key} name={name} onClick={() => roll(key, name)} />
                        <div class="characteristic-field">
                            <ReadonlyField field="calculatedValue" class="attribute textlike" id={key}
                                title="Permanent + Temporary" onClick={() => edit(key, "value")} />
                            <ReadonlyField field="calculatedUnnatural" class="attribute-unnatural textlike"
                                id={`${key}-unnatural`} maxLength={2} title="Unnatural, Permanent + Temporary"
                                onClick={() => edit(key, "unnatural")} />
                        </div>
                    </Scope>
                ))}
            </Scope>

            <div class={dropdown.open ? "characteristics-dropdown visible" : "characteristics-dropdown"}>
                <div class="layout-column">
                    <Scope dataId="characteristics" id="perm-characteristics" class="perm-temp-section">
                        <h4>Permanent</h4>
                        <div class="layout-row">
                            {CHARACTERISTICS.map(([key, name]) => (
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

                    <Conditions />
                </div>
            </div>
        </div>
    );
}
