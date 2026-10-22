// The Test Options of the attacks and powers of a block, under the ⚙ of its
// heading: the options that the test select of their rolls offers
// (state/testOptions.ts). The Magic test options of a sheet with
// Spellcasting also offer Cast.
import { useState } from "preact/hooks";
import { joinPath, usePath, useSheet } from "../components/context";
import { Select } from "../components/fields";
import { valueAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue } from "../schema/constants";
import { hasSpellcasting } from "../state/spellcasting";
import { CAST, CAST_GROUP, isCharacteristic, testBaseGroups, testBaseLabel, type TestBlock } from "../state/testOptions";

function TestOption({ itemId, block }: { itemId: string; block: TestBlock }) {
    const path = joinPath(usePath(), itemId);
    const { state, stats, actions } = useSheet();
    const base = String(valueAt(state, `${path}.base`) ?? "");
    const characteristic = String(valueAt(state, `${path}.characteristic`) ?? "");
    // Every option listing every skill of the sheet made thousands of <option>s on a
    // big sheet, most of the cost of opening the dropdown. A row lists its values only
    // until the pointer comes over it or focus into it: the lists are there before a
    // click, which would otherwise wait for them. Touch sends pointerenter before pointerdown.
    const [expanded, setExpanded] = useState(false);
    const expand = () => setExpanded(true);
    const groups = block === "psykana" && hasSpellcasting(state) ? [CAST_GROUP, ...testBaseGroups(state, stats)] : testBaseGroups(state, stats);
    const current = groups.flatMap(g => g.options).find(o => optionValue(o) === base);
    // A characteristic is tested on itself, so it drops the characteristic a skill had.
    const editBase = (value: string | number) => actions.batch(path,
        isCharacteristic(stats, String(value)) ? { base: value, characteristic: "" } : { base: value });
    return (
        <Scope dataId={itemId} class="test-option" onPointerEnter={expand} onFocusIn={expand}>
            <Select field="base" class="test-base" onEdit={editBase}>
                {!current && <option value={base}>{testBaseLabel(state, stats, base)}</option>}
                {!expanded && current && <option value={base}>{optionLabel(current)}</option>}
                {expanded && groups.map(g => (
                    <optgroup key={g.label} label={g.label}>
                        {g.options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
                    </optgroup>
                ))}
            </Select>
            <Select field="characteristic" class="test-characteristic" disabled={isCharacteristic(stats, base)}
                title={base === CAST ? "Tested on; — for the characteristic of each spell's Spellcasting" : "Tested on"}
                options={expanded
                    ? [{ value: "", label: "—" }, ...stats.skillCharacteristics]
                    : [{ value: characteristic, label: characteristic || "—" }]} />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** The test options of `block`, the block of the enclosing Scope. */
export function TestOptionList({ block }: { block: TestBlock }) {
    return (
        <ItemGrid dataId="testOptions.items" class="test-options" itemClass="test-option" idPrefix="test-option"
            renderItem={id => <TestOption itemId={id} block={block} />} />
    );
}
