// The coins of a Pathfinder Crusade character, in the Gear tab: a field per
// metal and their weight, with its ⚙ inside as a pool's maximum has it,
// where the weight can be turned off (state/coins.ts).
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField } from "../components/fields";
import { Scope } from "../components/Scope";
import { COINS, COINS_PER_KG, coinCount, coinsWeigh, coinsWeight } from "../state/coins";

function CoinsWeight() {
    const { state } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const weighs = useComputed(() => coinsWeigh(state)).value;
    const kg = useComputed(() => coinsWeight(state)).value;
    const count = useComputed(() => coinCount(state)).value;
    return (
        <div class="coins-weight">Weight:
            <div class="mod-field resource-field dropdown-parent" ref={ref}>
                <input type="text" data-id="weight" class="mod-total textlike" readOnly value={weighs ? String(kg) : ""} placeholder="off"
                    title={weighs ? `${count} coins, ${COINS_PER_KG} to a kg` : "Not in the encumbrance"} onClick={dropdown.show} />
                <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title="Whether the coins weigh"
                    onClick={dropdown.toggle}>⚙</button>
                {dropdown.open && (
                    <div class="roll-dropdown block-settings-dropdown visible">
                        <label class="block-rule">
                            <Checkbox field="countWeight" class="custom" />
                            <span>
                                <span class="block-rule-label">Coins weigh</span>
                                <span class="block-rule-text">{`${COINS_PER_KG} coins weigh 1 kg, counted in the encumbrance.`}</span>
                            </span>
                        </label>
                    </div>
                )}
            </div>
        </div>
    );
}

export function Coins() {
    const { actions } = useSheet();
    const path = joinPath(usePath(), "coins");
    return (
        <Scope dataId="coins" id="coins-bar" class="layout-row centered-bar">
            {COINS.map(c => (
                <label key={c.key} title={c.title}>{`${c.label}:`}
                    {/* Whole coins: Go reads them as integers. */}
                    <NumberField field={c.key} class="short" min={0}
                        onEdit={value => actions.change(joinPath(path, c.key), value === null ? null : Math.max(0, Math.round(value)))} />
                </label>
            ))}
            <CoinsWeight />
        </Scope>
    );
}
