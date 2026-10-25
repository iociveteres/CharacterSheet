// Suggestions for a movement mode (state/movement.ts): its SPD expression, as
// a damage modifier's without dice and with Size (damageSuggestions), led by
// what the traits of the sheet give; and its name, led by the modes those
// traits give. The trait names are the English ones of the gamedata.
import { filterGroups, type SuggestionGroup } from "../components/SuggestField";
import type { Characteristic } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { MOVEMENT_REFS } from "../damage";
import { damageSuggestions, insertTerm } from "./damageSuggestions";
import { idsInOrder } from "./gridOrder";
import { movementRefValue } from "./movement";
import { textAt } from "./sync";

/** The names a mode is suggested, in this order. */
export const MODE_NAMES = ["Move", "Flight", "Hover", "Burrow", "Swim", "Climb"] as const;

// Flyer, Hoverer and Burrower (X) move by their mode at SPD X, size ignored;
// Digitigrade (X) adds X on foot.
const MODE_OF_TRAIT: { [trait: string]: string } = { Flyer: "Flight", Hoverer: "Hover", Burrower: "Burrow" };
const TRAIT = /^\s*(Flyer|Hoverer|Burrower|Digitigrade)\s*\(\s*(\d+)\s*\)/i;

interface MovementTrait {
    /** The trait as the sheet names it, "Flyer (6)". */
    name: string;
    /** Flyer, Hoverer, Burrower or Digitigrade. */
    trait: string;
    value: number;
}

/** The traits of the sheet that change how it moves, in the order of the list. */
export function movementTraits(state: SheetSignals): MovementTrait[] {
    return idsInOrder(state, "traits.list.items").flatMap(id => {
        const name = textAt(state, `traits.list.items.${id}.name`).trim();
        const m = name.match(TRAIT);
        if (!m) return [];
        const trait = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
        return [{ name, trait, value: parseInt(m[2], 10) }];
    });
}

/** The SPDs that are a mode's whole SPD: those of Flyer, Hoverer and Burrower. */
const wholeSpds = (state: SheetSignals) =>
    new Set(movementTraits(state).filter(t => MODE_OF_TRAIT[t.trait]).map(t => String(t.value)));

/**
 * What the SPD term `query` can become: what the traits give, the bonus of a
 * characteristic or Size, with a factor or rounding; null before the player
 * typed lists them all. Each shows what it adds now.
 */
export function movementSuggestions(state: SheetSignals, characteristics: readonly Characteristic[], query: string | null): SuggestionGroup[] {
    const q = (query ?? "").trim().toLowerCase();
    const traits = {
        label: "From traits",
        options: movementTraits(state)
            .filter(({ name, value }) => !q || String(value).startsWith(q) || name.toLowerCase().includes(q))
            .map(({ name, trait, value }) => (MODE_OF_TRAIT[trait]
                ? { value: String(value), label: `${value} — ${name}, size ignored` }
                : { value: String(value), label: `+${value} — ${name}, on foot` })),
    };
    const rest = damageSuggestions(characteristics, query, ref => movementRefValue(state, ref), MOVEMENT_REFS, false);
    return [traits, ...rest].filter(g => g.options.length > 0);
}

/**
 * How a picked SPD suggestion goes into the expression: the SPD of Flyer,
 * Hoverer or Burrower replaces it, as size does not count; any other term is
 * put in as a damage modifier's (insertTerm).
 */
export const movementInsert = (state: SheetSignals) => (text: string, caret: number, value: string, typed: boolean): string =>
    (wholeSpds(state).has(value) ? value : insertTerm(text, caret, value, typed));

/** The names of a mode for `query`: those the traits of the sheet give first, then the rest of MODE_NAMES. */
export function modeNameSuggestions(state: SheetSignals, query: string | null): SuggestionGroup[] {
    const fromTraits = [...new Set(movementTraits(state).flatMap(t => (MODE_OF_TRAIT[t.trait] ? [MODE_OF_TRAIT[t.trait]] : [])))];
    const groups = [
        { label: "From traits", options: fromTraits.map(name => ({ value: name, label: `${name} — from traits` })) },
        { label: "Modes", options: MODE_NAMES.filter(name => !fromTraits.includes(name)) },
    ];
    return filterGroups(groups.filter(g => g.options.length > 0), query);
}
