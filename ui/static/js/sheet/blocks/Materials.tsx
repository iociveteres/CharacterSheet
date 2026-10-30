// The material, inlay gem and Broken mark of a gear item in Pathfinder
// Crusade (state/materials.ts): Broken in the row of Type, Carried and
// Equipped, a centered row of Material and Inlay under it. What the material
// does is in the title of its field; its numbers show where they count: the
// weight, the AP cells, Ench. and the attacks' Pen. The kind gives them to
// Gear (GearItemParts).
import { AutocompleteField } from "../components/AutocompleteField";
import { useSheet } from "../components/context";
import { Checkbox, Select } from "../components/fields";
import { Scope } from "../components/Scope";
import { INLAY_GEMS, type Option } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../system";
import { capLines, materialCaps } from "../state/caps";
import { hasMaterial, hasMetalRim, materialOf, type GearItem, type Material } from "../state/materials";
import { resolvePath } from "../state/sync";

const INLAY_OPTIONS: readonly Option[] = [
    { value: "", label: "—" },
    ...INLAY_GEMS.map(g => ({ value: g.name, label: `${g.name} +${g.capacityBonus}` })),
];

// Broken does something only to what has AP or deals damage; they have a material by default too.
const BREAKS = new Set(["weapon", "armour"]);

const itemAt = (path: string) => resolvePath(useSheet().state, path) as GearItem;

export function BrokenFlag({ path }: { path: string }) {
    if (!BREAKS.has(itemAt(path).gearType?.value ?? "")) return null;
    return (
        <label title="Broken: its AP is halved, rounded down">Broken
            <Checkbox field="broken" class="custom" />
        </label>
    );
}

/**
 * What the material does to an item of `gearType`, a line each; Pen counts
 * only in the attacks of the item. A cap the material raises shows as the
 * item's raised cap, as Max.A 65 = 35 Chainmail +20 Mithral, in place of the
 * material's short text.
 * The material of a shield with a Metal Rim is the rim's: no weight factor.
 */
export function materialEffects(state: SheetSignals, item: GearItem, material: Material): string[] {
    const gearType = item.gearType?.value;
    const caps = materialCaps(state, item);
    return [
        material.weightFactor !== 1 && !hasMetalRim(item) ? `wt ×${material.weightFactor}` : "",
        gearType === "armour" && material.ap !== 0 ? `AP ${signed(material.ap)}` : "",
        ...caps.map(({ key, cap }) => `Max.${key} ${cap.total} = ${capLines(cap).slice(0, -1).join(" ")}`),
        gearType === "weapon" && material.pen !== 0 ? `Pen ${signed(material.pen)} in the attacks linked to the item` : "",
        `Dur ${material.durability}`,
        `Cap ×${material.capacityFactor}`,
        !caps.length ? material.short : "",
        material.special && material.special !== material.short ? material.special : "",
    ].filter(Boolean);
}

/**
 * Material and Inlay of the item at `path`: shown to an editor of a weapon or
 * armour, of another item while `open` (its ＋ material), and to anyone once
 * either is set.
 */
export function MaterialRow({ path, open, setOpen }: { path: string; open: boolean; setOpen: (open: boolean) => void }) {
    const { state, canEdit } = useSheet();
    const item = itemAt(path);
    const material = materialOf(item);
    const usual = BREAKS.has(item.gearType?.value ?? "");
    if (!hasMaterial(item) && !(canEdit && (usual || open))) return null;
    // An opened row of another item closes when left empty.
    const onFocusOut = (e: FocusEvent) => {
        const row = e.currentTarget as HTMLElement;
        if (!row.contains(e.relatedTarget as Node | null) && !hasMaterial(resolvePath(state, path) as GearItem)) setOpen(false);
    };
    return (
        <div class="layout-row material-row" onFocusOut={onFocusOut}>
            {/* Not a label: a click on the dropdown inside one would go to the input. */}
            <Scope as="span" dataId="material" class="material-label">
                <span>Material:</span>
                <AutocompleteField field="name" itemPath={`${path}.material`} collection="materials" listAll autoFocus={open && !usual}
                    class="textlike material-input" placeholder="—"
                    title={material ? materialEffects(state, item, material).join("\n") : undefined} />
            </Scope>
            <label class="material-label">Inlay:
                <Select field="inlay" options={INLAY_OPTIONS} class="inlay-select" />
            </label>
        </div>
    );
}
