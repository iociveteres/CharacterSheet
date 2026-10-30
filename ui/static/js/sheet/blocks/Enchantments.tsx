// The enchantments of a gear item in Pathfinder Crusade (state/enchantments.ts):
// a line of chips like the mods, after them, with the capacity they take of
// the item's. The open one shows its levels as chips with their capacity; a
// click on one copies its text, special and entries over the enchantment's.
import { AutocompleteField } from "../components/AutocompleteField";
import { joinPath, usePath, useSheet } from "../components/context";
import { NumberField, TextArea, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { chipText, capacityUsed, levelBatch, levelIds, type Enchantment } from "../state/enchantments";
import { itemCapacity, type GearItem } from "../state/materials";
import { resolvePath } from "../state/sync";
import { ItemEntries } from "./ConditionEntries";
import { ChipRow } from "./Mods";

const enchantmentAt = (path: string) => resolvePath(useSheet().state, path) as Enchantment;

/** `Cap.` and the levels to choose from; an own enchantment, without levels, takes its capacity typed. */
function CapBlock({ path }: { path: string }) {
    const { canEdit, actions } = useSheet();
    const enchantment = enchantmentAt(path);
    const ids = levelIds(enchantment);
    const chosen = enchantment.level.value;
    return (
        <span class="cap-block">
            <span class="cap-label">Cap.</span>
            {ids.length === 0 && <NumberField field="capacity" class="short textlike" placeholder="—" />}
            {ids.map(id => {
                const level = enchantment.levels.items[id];
                return (
                    <button key={id} type="button" class={id === chosen ? "level-chip selected" : "level-chip"} disabled={!canEdit}
                        title={level.text.value} onClick={() => actions.batch(path, levelBatch(id, level))}>
                        {level.capacity.value}
                    </button>
                );
            })}
        </span>
    );
}

function EnchantmentDetails({ itemId, weapon }: { itemId: string; weapon: boolean }) {
    const path = joinPath(usePath(), itemId);
    // Special goes to the attacks of a weapon; another item shows it only when it has one.
    const special = weapon || !!enchantmentAt(path).special.value;
    return (
        <Scope dataId={itemId} class="mod-details">
            <div class="mod-header">
                <AutocompleteField field="name" class="mod-name textlike" placeholder="Name" itemPath={path} collection="enchantments" />
                <CapBlock path={path} />
            </div>
            <TextArea field="description" class="mod-description" placeholder=" " />
            {special && (
                <label class="ench-special">Special:
                    <TextField field="special" class="textlike" placeholder="—" />
                </label>
            )}
            <ItemEntries itemId={itemId} itemPath={path} framed={false} />
        </Scope>
    );
}

/** The enchantments of the gear item at `path`, which must be the enclosing path. */
export function Enchantments({ path }: { path: string }) {
    const { state } = useSheet();
    const item = resolvePath(state, path) as GearItem;
    const capacity = itemCapacity(item);
    const used = capacityUsed(item);
    const over = used > capacity.total;
    const title = ["Capacity for enchantments:", ...capacity.lines, ...(over ? ["The enchantments take more"] : [])].join("\n");
    const label = (
        <>Ench. <span class={over ? "ench-cap over" : "ench-cap"} title={title}>{used}/{capacity.total}</span>:</>
    );
    const weapon = item.gearType?.value === "weapon";
    return (
        <ChipRow dataId="enchantments.items" class="ench-mods" label={label} collection="enchantments" noun="enchantment" idPrefix="ench"
            chipText={p => chipText(resolvePath(state, p) as Enchantment)}
            details={id => <EnchantmentDetails key={id} itemId={id} weapon={weapon} />} />
    );
}
