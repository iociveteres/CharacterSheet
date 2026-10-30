// What an attack shows of the gear item it is linked to (state/itemLink.ts):
// the Item row under its header, the Special the item's enchantments add, and
// the In Gear group of its name's autocomplete. The gear item's own row of
// attacks is LinkedAttacks.tsx.
import { useComputed } from "@preact/signals";
import type { Autocomplete } from "../autocomplete";
import type { LocalResults } from "../components/AutocompleteField";
import { useSheet, type AutocompleteResult, type SheetEnv } from "../components/context";
import { Select } from "../components/fields";
import type { SheetSignals } from "../schema/sheet";
import {
    addedProperties, brokenItem, enchantmentNames, itemLabel, itemName, linkedInBlock, linkedItem, linkOf, weaponItems,
    type AttackBlock,
} from "../state/itemLink";
import { materialOf } from "../state/materials";

const ITEM_TITLE = "The gear item of this weapon: its material, enchantments and Broken count in the attack";
const DELETED_TITLE = "The linked gear item was deleted: it gives the attack nothing. Pick another or —.";

/**
 * The Item row of the attack at `attackPath`: — or one of the gear's weapons,
 * the enchantments of the linked one after it. Shown while the attack is
 * linked, and to an editor while the gear has weapons.
 */
export function ItemLinkRow({ attackPath }: { attackPath: string }) {
    const { state, canEdit } = useSheet();
    const link = useComputed(() => linkOf(state, attackPath)).value;
    const options = useComputed(() => weaponItems(state).map(({ id, item }) => ({ id, label: itemLabel(item) }))).value;
    if (!link && (!canEdit || options.length === 0)) return null;

    const deleted = link !== null && link.item === null;
    // An item that is no weapon any more keeps its link and its option.
    const own = link?.item && !options.some(o => o.id === link.id) ? [{ id: link.id, label: itemLabel(link.item) }] : [];
    const notes = link?.item ? enchantmentNames(link.item) : [];
    return (
        <div class="layout-row item-link-row">
            <label>Item:
                <Select field="item" class={deleted ? "item-link-select dimmed" : "item-link-select"} title={deleted ? DELETED_TITLE : ITEM_TITLE}>
                    <option value="">—</option>
                    {[...options, ...own].map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    {deleted && <option value={link.id}>deleted</option>}
                </Select>
            </label>
            {notes.length > 0 && <span class="item-note" data-id="itemNote" title="The enchantments of the item">{notes.join(", ")}</span>}
        </div>
    );
}

/** What the enchantments of the linked item add after the Special of the weapon at `weaponPath`, as "+ Flame (d10)". */
export function ItemProperties({ weaponPath }: { weaponPath: string }) {
    const { state } = useSheet();
    const added = useComputed(() => addedProperties(state, weaponPath)).value;
    const item = linkedItem(state, weaponPath);
    if (!added.length || !item) return null;
    return (
        <span class="added-property" data-id="itemProperties" title={added.map(p => `${p.text}: the ${p.source} enchantment of ${itemName(item)}`).join("\n")}>
            {`+ ${added.map(p => p.text).join(", ")}`}
        </span>
    );
}

/** The roll label of a damage, marked while the linked item is broken: the GM halves what armour lets through. */
export const damageRollLabel = (state: SheetSignals, weaponPath: string, label: string) =>
    (brokenItem(state, weaponPath) ? `${label} (broken: ½ after armour)` : label);

/** The entry of `collection` named `name` exactly, in any case; null when the rulebook has none or no answer comes. */
export async function findEntry(autocomplete: Autocomplete, kind: string, collection: string, name: string): Promise<AutocompleteResult | null> {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return null;
    const results = await autocomplete.lookup({ type: "autocomplete", kind, collection, query: name.trim() });
    return results.find(r => String(r.name).trim().toLowerCase() === wanted) ?? null;
}

/**
 * Links the attack at `attackPath` to the gear item `itemId` named `name`:
 * filled from the rulebook entry of that name over `base`, as a pick of it
 * fills it, or, for a name the rulebook lacks, only named and linked.
 */
export async function linkToItem(env: Pick<SheetEnv, "autocomplete" | "kindName" | "actions">, attackPath: string, collection: string,
    base: () => object, itemId: string, name: string): Promise<void> {
    const entry = env.autocomplete ? await findEntry(env.autocomplete, env.kindName, collection, name) : null;
    if (entry) env.actions.autocompleteApply(attackPath, collection, entry.name, { ...base(), item: itemId });
    else env.actions.batch(attackPath, { name, item: itemId });
}

/** The gear weapon as a result of the In Gear group: its name, and its material and enchantments where the type goes. */
function gearResult(state: SheetSignals, id: string): AutocompleteResult {
    const item = state.gear.list.items[id];
    const material = materialOf(item);
    const enchantments = enchantmentNames(item).join(", ");
    return { name: itemName(item), entryType: [material?.name, enchantments].filter(Boolean).join(" · "), gearItem: id };
}

/**
 * The In Gear group of the name of the attack at `attackPath` in `block`:
 * the gear's weapons whose name holds the query, but those another attack of
 * the block is linked to. A pick links the attack (linkToItem).
 */
export function useInGear(attackPath: string, block: AttackBlock, collection: string, base: () => object): LocalResults {
    const env = useSheet();
    const { state } = env;
    return {
        group: "In Gear",
        results: query => weaponItems(state)
            .filter(({ id, item }) => String(item.name?.value ?? "").toLowerCase().includes(query.toLowerCase())
                && !linkedInBlock(state, block, id, attackPath))
            .map(({ id }) => gearResult(state, id)),
        pick: r => void linkToItem(env, attackPath, collection, base, String(r.gearItem), r.name),
    };
}
