// The Test Options dropdown of psykana and techno arcana: the options that the base
// select of the block's powers offers (state/testOptions.ts).
import { useRef, useState } from "preact/hooks";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Select } from "../components/fields";
import { valueAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue } from "../schema/constants";
import { isCharacteristic, testBaseGroups, testBaseLabel } from "../state/testOptions";

function TestOption({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { stats, actions } = useSheet();
    const base = String(valueAt(`${path}.base`) ?? "");
    const characteristic = String(valueAt(`${path}.characteristic`) ?? "");
    // Every option listing every skill of the sheet made thousands of <option>s on a
    // big sheet, most of the cost of opening the dropdown. A row lists its values only
    // until the pointer comes over it or focus into it: the lists are there before a
    // click, which would otherwise wait for them. Touch sends pointerenter before pointerdown.
    const [expanded, setExpanded] = useState(false);
    const expand = () => setExpanded(true);
    const groups = testBaseGroups(stats);
    const current = groups.flatMap(g => g.options).find(o => optionValue(o) === base);
    // A characteristic is tested on itself, so it drops the characteristic a skill had.
    const editBase = (value: string | number) => actions.batch(path,
        isCharacteristic(stats, String(value)) ? { base: value, characteristic: "" } : { base: value });
    return (
        <Scope dataId={itemId} class="test-option" onPointerEnter={expand} onFocusIn={expand}>
            <Select field="base" class="test-base" onEdit={editBase}>
                {!current && <option value={base}>{testBaseLabel(stats, base)}</option>}
                {!expanded && current && <option value={base}>{optionLabel(current)}</option>}
                {expanded && groups.map(g => (
                    <optgroup key={g.label} label={g.label}>
                        {g.options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
                    </optgroup>
                ))}
            </Select>
            <Select field="characteristic" class="test-characteristic" title="Tested on" disabled={isCharacteristic(stats, base)}
                options={expanded
                    ? [{ value: "", label: "—" }, ...stats.skillCharacteristics]
                    : [{ value: characteristic, label: characteristic || "—" }]} />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** The Test Options button and its dropdown, inside the Scope of psykana or techno arcana. */
export function TestOptions() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <div class="dropdown-parent test-options" ref={ref}>
            <button type="button" class={dropdown.open ? "test-options-toggle button-colored active" : "test-options-toggle button-colored"}
                onClick={dropdown.toggle}>Test Options</button>
            {/* Rendered only while open: every option lists the skills of the sheet. */}
            {dropdown.open && (
                <div class="roll-dropdown roll-dropdown-centered test-options-dropdown visible">
                    <ItemGrid dataId="testOptions.items" itemClass="test-option" idPrefix="test-option"
                        renderItem={id => <TestOption itemId={id} />} />
                </div>
            )}
        </div>
    );
}
