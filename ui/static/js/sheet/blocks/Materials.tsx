// The material, inlay gem and Broken mark of a gear item in Pathfinder
// Crusade (state/materials.ts): a centered row of Material and Inlay under
// the item's Type, Carried and Equipped, a grey line of what the material
// does, and Broken in that row. The kind gives them to Gear (GearItemParts).
import { Fragment } from "preact";
import { AutocompleteField } from "../components/AutocompleteField";
import { useSheet } from "../components/context";
import { Checkbox, Select } from "../components/fields";
import { Scope } from "../components/Scope";
import { INLAY_GEMS, type Option } from "../schema/constants";
import { signed } from "../system";
import { capLines, materialCaps } from "../state/caps";
import { itemCapacity, materialOf, type GearItem, type Material } from "../state/materials";
import { resolvePath } from "../state/sync";

const INLAY_OPTIONS: readonly Option[] = [
    { value: "", label: "—" },
    ...INLAY_GEMS.map(g => ({ value: g.name, label: `${g.name} +${g.capacityBonus}` })),
];

// Broken does something only to what has AP or deals damage.
const BREAKS = new Set(["weapon", "armour"]);

const itemAt = (path: string) => resolvePath(useSheet().state, path) as GearItem;

export function BrokenFlag({ path }: { path: string }) {
    if (!BREAKS.has(itemAt(path).gearType?.value ?? "")) return null;
    return (
        <label title="Broken: its AP is halved, rounded down">Broken:
            <Checkbox field="broken" class="custom" />
        </label>
    );
}

/**
 * What the material does to an item of `gearType`, dot-separated; Pen counts
 * only in the attacks of the item. A cap the material raises shows as the
 * item's raised cap, as Max.A 65, in place of the material's short text.
 */
function MaterialEffects({ item, material }: { item: GearItem; material: Material }) {
    const { state } = useSheet();
    const gearType = item.gearType?.value;
    const capacity = itemCapacity(item);
    const caps = materialCaps(state, item);
    const parts = [
        material.weightFactor !== 1 && <span>wt ×{material.weightFactor}</span>,
        gearType === "armour" && material.ap !== 0 && <span>AP {signed(material.ap)}</span>,
        ...caps.map(({ key, cap }) => (
            <span class="raised-cap" data-id={`max${key}`} title={capLines(cap).join("\n")}>Max.{key} {cap.total}</span>
        )),
        gearType === "weapon" && material.pen !== 0 && (
            <span class="later" data-id="materialPen" title="Counts in the attacks linked to the item">Pen {signed(material.pen)}</span>
        ),
        <span>Dur {material.durability}</span>,
        <span data-id="capacity" title={`Capacity for enchantments:\n${capacity.lines.join("\n")}`}>Cap ×{material.capacityFactor}</span>,
        !caps.length && material.short && <span>{material.short}</span>,
    ].filter(Boolean);
    return (
        <div class="material-effects" data-id="materialEffects">
            {parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}
        </div>
    );
}

/** Material and Inlay of the item at `path`, and the line of the material's effects; nothing for a viewer of an item without them. */
export function MaterialRows({ path }: { path: string }) {
    const { canEdit } = useSheet();
    const item = itemAt(path);
    const material = materialOf(item);
    if (!canEdit && !material && !item.inlay?.value) return null;
    return (
        <>
            <div class="layout-row material-row">
                {/* Not a label: a click on the dropdown inside one would go to the input. */}
                <Scope as="span" dataId="material" class="material-label">
                    <span>Material:</span>
                    <AutocompleteField field="name" itemPath={`${path}.material`} collection="materials"
                        class="textlike material-input" placeholder="—" title={material?.special || material?.short || undefined} />
                </Scope>
                <label class="material-label">Inlay:
                    <Select field="inlay" options={INLAY_OPTIONS} class="inlay-select" />
                </label>
            </div>
            {material && <MaterialEffects item={item} material={material} />}
        </>
    );
}
