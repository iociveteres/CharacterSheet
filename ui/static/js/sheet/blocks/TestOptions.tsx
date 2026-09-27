// The Tests dropdown of psykana and techno arcana: the options that the base
// select of the block's powers offers (state/testOptions.ts).
import { useRef } from "preact/hooks";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Select, valueAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue } from "../schema/constants";
import { testBaseGroups, testBaseLabel } from "../state/testOptions";

function TestOption({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { stats } = useSheet();
    const base = String(valueAt(`${path}.base`) ?? "");
    const groups = testBaseGroups(stats);
    const known = groups.some(g => g.options.some(o => optionValue(o) === base));
    const isCharacteristic = stats.characteristics.some(c => c.key === base);
    return (
        <Scope dataId={itemId} class="test-option">
            <Select field="base" class="test-base">
                {!known && <option value={base}>{testBaseLabel(stats, base)}</option>}
                {groups.map(g => (
                    <optgroup key={g.label} label={g.label}>
                        {g.options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
                    </optgroup>
                ))}
            </Select>
            <Select field="characteristic" class="test-characteristic" title="Tested on" disabled={isCharacteristic}
                options={[{ value: "", label: "—" }, ...stats.skillCharacteristics]} />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** The Tests button and its dropdown, inside the Scope of psykana or techno arcana. */
export function TestOptions() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <div class="dropdown-parent test-options" ref={ref}>
            <button type="button" class={dropdown.open ? "tests-toggle button-colored active" : "tests-toggle button-colored"}
                onClick={dropdown.toggle}>Tests</button>
            <div class={dropdown.open ? "roll-dropdown roll-dropdown-centered test-options-dropdown visible" : "roll-dropdown roll-dropdown-centered test-options-dropdown"}>
                <ItemGrid dataId="testOptions.items" itemClass="test-option" idPrefix="test-option"
                    renderItem={id => <TestOption itemId={id} />} />
            </div>
        </div>
    );
}
