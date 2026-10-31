// What an attack shows of the gear item it is linked to (state/itemLink.ts):
// the grey mark in its name, which says the trait of a Natural Weapons
// attack too (state/traitLink.ts), the Special the item's enchantments add,
// and the In Gear group of its name's autocomplete. The gear item's own row
// of attacks is LinkedAttacks.tsx.
import { useLayoutEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import type { Autocomplete } from "../autocomplete";
import type { LocalResults } from "../components/AutocompleteField";
import { useSheet, type AutocompleteResult, type SheetEnv } from "../components/context";
import type { SheetSignals } from "../schema/sheet";
import {
    MELEE_ATTACKS, addedProperties, brokenItem, enchantmentNames, itemName, linkedInBlock, linkedItem, linkOf, weaponItems,
    type AttackBlock,
} from "../state/itemLink";
import { traitLinkOf } from "../state/traitLink";
import { materialOf } from "../state/materials";
import { textAt } from "../state/sync";

const ITEM_TITLE = "From the gear: its material, enchantments and Broken count in the attack. Pick another name to unlink.";
const DELETED_TITLE = "The linked gear item was deleted: it gives the attack nothing. Pick another name to unlink.";
const TRAIT_TITLE = "From the Natural Weapons trait: X in its name, as Natural Weapons (2), adds to the damage, and to Pen when it is Deadly.";

/** Why the trait named `name` gives nothing or 0; null when X counts. */
function traitWarning(name: string, rating: number | null | undefined): string | null {
    if (rating === undefined) return `${name} is no Natural Weapons trait: it gives the attack nothing. Pick another name to unlink.`;
    if (rating === null) return `No number in the brackets of ${name}: X counts as 0. Put it in the trait's name, as Natural Weapons (2).`;
    return null;
}

export interface LinkMark {
    text: string;
    /** The title of the name's field: the mark itself lets clicks through to the field. */
    title: string;
    /** Deleted, or no Natural Weapons trait: it gives nothing. */
    dimmed?: boolean;
    /** A trait without X. */
    invalid?: boolean;
}

/** What the mark of the attack at `attackPath` says: its gear item, else its trait; null without a link. */
function markOf(state: SheetSignals, attackPath: string): LinkMark | null {
    const link = linkOf(state, attackPath);
    if (link) {
        return link.item
            ? { text: "· gear", title: ITEM_TITLE }
            : { text: "· deleted", title: DELETED_TITLE, dimmed: true };
    }
    const trait = attackPath.startsWith("meleeAttacks.") ? traitLinkOf(state, attackPath) : null;
    if (!trait) return null;
    if (trait.name === null) return { text: "· deleted", title: DELETED_TITLE.replace("gear item", "trait"), dimmed: true };
    const warning = traitWarning(trait.name, trait.natural ? trait.natural.rating : undefined);
    return { text: `· ${trait.name}`, title: warning ?? TRAIT_TITLE, dimmed: !trait.natural, invalid: !!trait.natural && !!warning };
}

/** The link mark of the attack at `attackPath`; null without a link. */
export function useLinkMark(attackPath: string): LinkMark | null {
    const { state } = useSheet();
    return useComputed(() => markOf(state, attackPath)).value;
}

let measure: CanvasRenderingContext2D | null = null;

/** The width of the text of `input` in its font. */
function textWidth(input: HTMLInputElement): number {
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return 0;
    const cs = getComputedStyle(input);
    measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return measure.measureText(input.value).width;
}

/** Puts `mark` right after the text of the input before it, or over the input's end while the text runs that far. */
function place(mark: HTMLElement): void {
    const input = mark.parentElement?.querySelector("input");
    if (!input) return;
    const cs = getComputedStyle(input);
    const start = input.offsetLeft + input.clientLeft + parseFloat(cs.paddingLeft);
    const end = input.offsetLeft + input.clientLeft + input.clientWidth - parseFloat(cs.paddingRight);
    const after = start + textWidth(input) - input.scrollLeft + 4;
    mark.style.left = `${Math.max(start, Math.min(after, end - mark.offsetWidth))}px`;
}

const unlinkFields = (attackPath: string) => ({ item: "", ...(attackPath.startsWith("meleeAttacks.") ? { trait: "" } : {}) });

/**
 * The grey `mark` after the name of the attack at `attackPath`, inside its
 * field (useLinkMark): "· gear" while a gear item's, the trait's name while a
 * Natural Weapons trait's. A pick of the name links it (useInGear,
 * useInTraits); a pick from the rulebook unlinks it, as the pick replaces the
 * whole attack, and so does leaving the name empty.
 */
export function AttackLinkMark({ attackPath, mark }: { attackPath: string; mark: LinkMark | null }) {
    const { state, canEdit, actions } = useSheet();
    // Read so that the mark moves with the name, also when another player renames it.
    textAt(state, `${attackPath}.name`);
    const ref = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        if (ref.current) place(ref.current);
    });
    const shown = mark !== null;
    useLayoutEffect(() => {
        const el = ref.current;
        const input = el?.parentElement?.querySelector("input");
        if (!el || !input) return;
        const replace = () => place(el);
        const unlinkEmpty = () => {
            if (canEdit && !input.value.trim()) actions.batch(attackPath, unlinkFields(attackPath));
        };
        const resized = new ResizeObserver(replace);
        resized.observe(input);
        input.addEventListener("scroll", replace);
        input.addEventListener("input", replace);
        input.addEventListener("change", unlinkEmpty);
        return () => {
            resized.disconnect();
            input.removeEventListener("scroll", replace);
            input.removeEventListener("input", replace);
            input.removeEventListener("change", unlinkEmpty);
        };
    }, [shown, canEdit, attackPath]);

    if (!mark) return null;
    const cls = ["attack-link-mark", mark.dimmed && "dimmed", mark.invalid && "invalid"].filter(Boolean).join(" ");
    return <span ref={ref} class={cls} data-id="linkMark">{mark.text}</span>;
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
 * Links the attack at `attackPath` by `link`, as `{ item: id }`, under the
 * name `name`: filled from the rulebook entry of that name over `base`, as a
 * pick of it fills it, or, for a name the rulebook lacks, only named and linked.
 */
export async function linkAttack(env: Pick<SheetEnv, "autocomplete" | "kindName" | "actions">, attackPath: string, collection: string,
    base: () => object, link: { [field: string]: string }, name: string): Promise<void> {
    const entry = env.autocomplete ? await findEntry(env.autocomplete, env.kindName, collection, name) : null;
    if (entry) env.actions.autocompleteApply(attackPath, collection, entry.name, { ...base(), ...link });
    else env.actions.batch(attackPath, { name, ...link });
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
 * the block is linked to. A pick links the attack (linkAttack).
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
        // A melee attack is a gear item's or a trait's, not both.
        pick: r => void linkAttack(env, attackPath, collection, base,
            { item: String(r.gearItem), ...(block === MELEE_ATTACKS ? { trait: "" } : {}) }, r.name),
    };
}
