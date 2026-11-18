// What an attack shows of the gear item it is linked to (gear/itemLinkRules.ts):
// the grey mark in its name, which says the trait of a Natural Weapons
// attack too (traitLinkRules.ts), the Special the item's enchantments and
// Quality add, the Special field without what the Quality removes, and the In
// Gear group of its name's autocomplete. The gear item's own row of attacks is LinkedAttacks.tsx.
import { useLayoutEffect, useRef } from "preact/hooks";
import { t } from "../../i18n";
import { useComputed } from "@preact/signals";
import type { Autocomplete } from "../autocomplete";
import type { LocalResults } from "../components/AutocompleteField";
import { useSheet, type AutocompleteResult, type SheetEnv } from "../components/context";
import { TextField } from "../components/fields";
import { TotalOrOwn } from "../components/TotalOrOwn";
import type { SheetSignals } from "../schema/sheet";
import {
    MELEE_ATTACKS, addedProperties, brokenItem, enchantmentNames, itemName, linkedInBlock, linkedItem, linkOf, weaponItems,
    type AttackBlock,
} from "../gear/itemLinkRules";
import { qualitySpecial, shownSpecial } from "../gear/quality";
import { traitLinkOf } from "./traitLinkRules";
import { materialOf } from "../gear/materialRules";
import { textAt } from "../core/sync";
import { WRAP, type Label } from "../rollLabel";

const ITEM_TITLE = t("sheet.weapons.link.itemTitle");
const TRAIT_TITLE = t("sheet.weapons.link.traitTitle");
const GEAR_MARK = `· ${t("sheet.weapons.link.gear")}`;
const DELETED_MARK = `· ${t("sheet.weapons.link.deleted")}`;

/** Why the trait named `name` gives nothing or 0; null when X counts. */
function traitWarning(name: string, rating: number | null | undefined): string | null {
    if (rating === undefined) return t("sheet.weapons.link.notTrait", { name });
    if (rating === null) return t("sheet.weapons.link.noRating", { name });
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
            ? { text: GEAR_MARK, title: ITEM_TITLE }
            : { text: DELETED_MARK, title: t("sheet.weapons.link.itemDeleted"), dimmed: true };
    }
    const trait = attackPath.startsWith("meleeAttacks.") ? traitLinkOf(state, attackPath) : null;
    if (!trait) return null;
    if (trait.name === null) return { text: DELETED_MARK, title: t("sheet.weapons.link.traitDeleted"), dimmed: true };
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

/** What the enchantments and Quality of the linked item add after the Special of the weapon at `weaponPath`, as "+ Flame (d10)". */
export function ItemProperties({ weaponPath }: { weaponPath: string }) {
    const { state } = useSheet();
    const added = useComputed(() => addedProperties(state, weaponPath)).value;
    const quality = useComputed(() => qualitySpecial(state, weaponPath)).value;
    const item = linkedItem(state, weaponPath);
    const names = [...added.map(p => p.text), ...(quality?.added ?? [])];
    if (!item || !names.length) return null;
    const lines = [...added.map(p => t("sheet.weapons.link.enchantmentOf", { property: p.text, enchantment: p.source, item: itemName(item) })), ...(quality?.lines ?? [])];
    return <span class="added-property" data-id="itemProperties" title={lines.join("\n")}>{`+ ${names.join(", ")}`}</span>;
}

/**
 * The Special of the weapon at `weaponPath`: unfocused, without what the
 * Quality of its linked item removes, as Best.Q does Primitive; its own on
 * focus. Not underlined as a computed number is: it is text, and long.
 */
export function SpecialField({ weaponPath }: { weaponPath: string }) {
    const { state } = useSheet();
    const shown = useComputed(() => shownSpecial(state, weaponPath)).value;
    return (
        <TotalOrOwn total={shown?.text ?? null} title={shown?.title ?? ""} totalId="specialShown" class=""
            own={props => <TextField field="special" {...props} />} />
    );
}

/** The roll label of a damage, marked while the linked item is broken: the GM halves what armour lets through. */
export const damageRollLabel = (state: SheetSignals, weaponPath: string, label: Label): Label =>
    (brokenItem(state, weaponPath) ? { ...label, w: WRAP.broken } : label);

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
        group: t("sheet.weapons.link.inGear"),
        results: query => weaponItems(state)
            .filter(({ id, item }) => String(item.name?.value ?? "").toLowerCase().includes(query.toLowerCase())
                && !linkedInBlock(state, block, id, attackPath))
            .map(({ id }) => gearResult(state, id)),
        // A melee attack is a gear item's or a trait's, not both.
        pick: r => void linkAttack(env, attackPath, collection, base,
            { item: String(r.gearItem), ...(block === MELEE_ATTACKS ? { trait: "" } : {}) }, r.name),
    };
}
