// The rules of psychic powers the sheet counts: the types a power's subtypes
// name, the psy rating a cast can take, the sustained powers and the
// phenomena. Reactive when read inside a computed.
import { characteristicBonus } from "./characteristics";
import { idsInOrder } from "./gridOrder";
import { giftOf } from "./spellcasting";
import { numberAt, textAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

export interface PowerTraits {
    /** Whether the power can be sustained: its Sustained field names an action. */
    sustainable: boolean;
    /** Cycle (X): sustaining it may be free when cast at ePR X or more; null when X is not given. */
    cycle?: number | null;
    /** Repeatable (X): X casts are sustained at once, the ones after them are not. */
    repeatable?: number | null;
    /** Upkeep (X), «Поддержание (X)» of Pathfinder Crusade: X mana at the start of each turn it is sustained. */
    upkeep?: number | null;
    /** Sorcery (X), «Колдовство (X)» of Pathfinder Crusade: a half-caster's spell of class X, cast on a skill (state/sorcery.ts). */
    sorcery?: string;
}

// What the Sustained field of a power that cannot be sustained says.
const NOT_SUSTAINED = new Set(["", "нет", "no", "none", "-", "–", "—"]);

const TYPE = /^(цикл|cycle|повторяемая|repeatable|поддержание|upkeep)\s*(?:\(\s*(\d+)\s*\))?$/i;

// The class is required: «Колдовство» alone is a discipline of the wiki.
const SORCERY = /^(?:sorcery|колдовство)\s*\(\s*([^()]*[^()\s])\s*\)$/i;

/** The traits of a power from its Subtypes ("Призыв, Цикл (5)") and Sustained fields. */
export function powerTraits(subtypes: string, sustained: string): PowerTraits {
    const traits: PowerTraits = { sustainable: !NOT_SUSTAINED.has(sustained.trim().toLowerCase()) };
    for (const part of subtypes.split(",")) {
        const sorcery = part.trim().match(SORCERY);
        if (sorcery) traits.sorcery = sorcery[1];
        const m = part.trim().match(TYPE);
        if (!m) continue;
        const x = m[2] === undefined ? null : parseInt(m[2], 10);
        if (/^(цикл|cycle)$/i.test(m[1])) traits.cycle = x;
        else if (/^(поддержание|upkeep)$/i.test(m[1])) traits.upkeep = x;
        else traits.repeatable = x;
    }
    return traits;
}

/** The traits of the power at `powerPath`. */
export const powerTraitsAt = (state: SheetSignals, powerPath: string) => powerTraits(textAt(state, `${powerPath}.subtypes`), textAt(state, `${powerPath}.sustained`));

/** Whether the sheet's kind has Sorcery spells: only the Pathfinder Crusade schema adds their Focus pools. */
export const hasSorcery = (state: SheetSignals) => "focus" in state;

/** Whether the power at `powerPath` is a Sorcery spell: typed so, on a sheet that has them. */
export const isSorcery = (state: SheetSignals, powerPath: string) =>
    hasSorcery(state) && powerTraitsAt(state, powerPath).sorcery !== undefined;

export type PsykanaRule = "sustained" | "cycle" | "phenomena";

/** Whether the sheet counts `rule` (settings.psykana). */
export const psykanaRule = (state: SheetSignals, rule: PsykanaRule) => !!valueAt(state, `settings.psykana.${rule}`);

/** The psychic powers of the sheet, tab by tab in the order they show. */
export function psychicPowers(state: SheetSignals): { path: string; tabId: string; tabPath: string }[] {
    return idsInOrder(state, "psykana.tabs.items").flatMap(tabId => {
        const tabPath = `psykana.tabs.items.${tabId}`;
        return idsInOrder(state, `${tabPath}.powers.items`).map(id => ({ path: `${tabPath}.powers.items.${id}`, tabId, tabPath }));
    });
}

export interface SustainedPower {
    path: string;
    tabId: string;
    name: string;
    /** How many of its casts are sustained: more than one only for Repeatable. */
    copies: number;
    /** The PR of its last sustained cast. */
    pr: number;
    /** Cast free by Cycle and within the free ones ½I.b▲ allows. */
    free: boolean;
    /** Cast free by Cycle, but past the ones ½I.b▲ allows. */
    overFree: boolean;
    /** What it takes from the PR. */
    taken: number;
    /** The mana its Upkeep (X) costs a turn, X per cast; 0 without the type or its X. */
    upkeep: number;
    /** A Sorcery spell (state/sorcery.ts), which takes no PR. */
    sorcery?: boolean;
}

export interface Sustained {
    powers: SustainedPower[];
    /** What they take from the PR together. */
    taken: number;
    /** How many powers Cycle can sustain free: ½I.b▲. */
    freeLimit: number;
    /** The mana their Upkeep costs a turn together. */
    upkeep: number;
}

/**
 * The powers cast by PR marked sustained and what they take from the PR: one
 * per copy, but those cast free by Cycle, as many as ½I.b▲, in the order of
 * the tabs. Without the power at `exceptPath`, as while it is cast again.
 * Sorcery spells take no PR: state/sorcery.ts counts them.
 */
export function sustainedPowers(state: SheetSignals, exceptPath?: string): Sustained {
    const freeLimit = Math.ceil(characteristicBonus(state, "I") / 2);
    const cycle = psykanaRule(state, "cycle");
    let freeLeft = freeLimit;
    const powers: SustainedPower[] = [];
    for (const { path, tabId } of psychicPowers(state)) {
        if (path === exceptPath || isSorcery(state, path)) continue;
        const copies = numberAt(state, `${path}.sustain.copies`);
        if (copies <= 0) continue;
        const castFree = cycle && !!valueAt(state, `${path}.sustain.free`);
        const free = castFree && freeLeft > 0;
        if (free) freeLeft--;
        powers.push({
            path, tabId, copies, free,
            name: textAt(state, `${path}.name`).trim() || "Psychic Power",
            pr: numberAt(state, `${path}.sustain.pr`),
            overFree: castFree && !free,
            taken: free ? 0 : copies,
            // Cycle does not spare it (wiki «v магия › механика › Поддержание (Х)»).
            upkeep: (powerTraitsAt(state, path).upkeep ?? 0) * copies,
        });
    }
    const total = (key: "taken" | "upkeep") => powers.reduce((sum, p) => sum + p[key], 0);
    return { powers, taken: total("taken"), freeLimit, upkeep: total("upkeep") };
}

/**
 * The sustained powers as the rules count them: those marked while the sheet
 * counts them (settings.psykana.sustained), Sustained Powers as typed
 * otherwise. The marked ones leave out the power at `exceptPath`, which the
 * typed number cannot.
 */
export function sustaining(state: SheetSignals, exceptPath?: string): { taken: number; any: boolean } {
    if (!psykanaRule(state, "sustained")) {
        const typed = numberAt(state, "psykana.sustainedPowers");
        return { taken: typed, any: typed > 0 };
    }
    const { powers, taken } = sustainedPowers(state, exceptPath);
    // A power sustained free by Cycle takes no PR, but it is sustained.
    return { taken, any: powers.length > 0 };
}

/**
 * The PR a normal cast of the power at `powerPath` has: the current PR, or
 * the base PR when a talent lets the power ignore the sustained powers. A
 * power cast again ends its own sustaining first, unless it is Repeatable;
 * a power past the free ones of Cycle may then become free.
 */
export function castCap(state: SheetSignals, powerPath: string): number {
    if (valueAt(state, `${powerPath}.ignoreTprPenalty`)) return numberAt(state, "psykana.basePR");
    const except = powerTraitsAt(state, powerPath).repeatable === undefined ? powerPath : undefined;
    return numberAt(state, "psykana.basePR") - sustaining(state, except).taken;
}

/**
 * How a cast of `pr` that succeeded changes the sustaining of the power at
 * `powerPath`, or null when it does not: another power replaces its own
 * sustained cast; a Repeatable (X) one adds a copy until X are sustained.
 */
export function sustainAfterCast(state: SheetSignals, powerPath: string, pr: number, free: boolean): { copies: number; pr: number; free: boolean } | null {
    const { repeatable } = powerTraitsAt(state, powerPath);
    if (repeatable === undefined) return { copies: 1, pr, free };
    const copies = numberAt(state, `${powerPath}.sustain.copies`);
    return copies < (repeatable ?? 1) ? { copies: copies + 1, pr, free } : null;
}

/** The ePR of a safe cast: half the PR of a normal one, rounded up. */
export const safePR = (cap: number) => Math.ceil(cap / 2);

/** Why a cast calls for phenomena: pushed always, a normal one on doubles of a success or on 99. */
export type PhenomenaReason = "pushed" | "doubles" | "99" | "";

export function phenomenaReason(cast: { safe: boolean; kick: number }, outcome: { success: boolean; doubles: boolean; roll: number } | null): PhenomenaReason {
    if (cast.safe) return "";
    if (cast.kick > 0) return "pushed";
    if (!outcome) return "";
    if (outcome.success && outcome.doubles) return "doubles";
    return outcome.roll === 99 ? "99" : "";
}

export interface PhenomenaPart {
    key: "nature" | "sustained" | "power" | "other";
    label: string;
    value: number;
}

export interface Phenomena {
    /** The power cast last, if it is still on the sheet. */
    power: { path: string; name: string; kick: number; safe: boolean; reason: PhenomenaReason } | null;
    parts: PhenomenaPart[];
    total: number;
}

/** Whether the gift of the power at `powerPath` lets its cast push: an Arcane one (Pathfinder Crusade) does not. */
export const canPush = (state: SheetSignals, powerPath: string): boolean => giftOf(state, powerPath) !== "Arcane";

/** The kick of the cast set up in the roll of the power at `powerPath`: none for a safe cast or a gift that cannot push. */
export const rollKick = (state: SheetSignals, powerPath: string): number =>
    valueAt(state, `${powerPath}.roll.safe`) || !canPush(state, powerPath) ? 0 : numberAt(state, `${powerPath}.roll.kickPR`);

/**
 * What the nature of the gift adds to the phenomena of a cast with `kick`:
 * a normal cast Unbound and Daemonic +10, a pushed one Bound +10, Unbound +5
 * and Daemonic +10 per point of kick.
 */
function natureMod(nature: string, kick: number): number {
    if (kick <= 0) return nature === "Unbound" || nature === "Daemonic" ? 10 : 0;
    return nature === "Bound" ? 10 : nature === "Unbound" ? 5 * kick : nature === "Daemonic" ? 10 * kick : 0;
}

/**
 * What the phenomena roll adds to 1d100: the nature of the gift of the last
 * cast power by its kick (natureMod), the sustained powers, the last power's
 * own modifier and the other ones.
 */
export function phenomena(state: SheetSignals): Phenomena {
    const id = textAt(state, "psykana.lastCastPower");
    const path = id ? psychicPowers(state).find(p => p.path.endsWith(`.powers.items.${id}`))?.path : undefined;
    const power = path ? {
        path,
        name: textAt(state, `${path}.name`).trim() || "Psychic Power",
        kick: numberAt(state, `${path}.cast.kick`),
        safe: !!valueAt(state, `${path}.cast.safe`),
        reason: textAt(state, `${path}.cast.phenomena`) as PhenomenaReason,
    } : null;

    const nature = giftOf(state, path);
    // A safe cast has no phenomena, nor a sheet that cast nothing yet.
    const cast = power && !power.safe ? power : null;
    const kick = cast ? cast.kick : 0;

    const parts: PhenomenaPart[] = [
        { key: "nature", label: kick > 0 ? `${nature || "Nature"}, kick ${kick}` : nature || "Nature", value: cast ? natureMod(nature, kick) : 0 },
        { key: "sustained", label: "Sustained powers", value: sustaining(state).any ? numberAt(state, "psykana.sustainPenalty") : 0 },
        { key: "power", label: power ? `${power.name}'s own` : "The power's own", value: power ? numberAt(state, `${path}.phenomenaMod`) : 0 },
    ];
    const other = idsInOrder(state, "psykana.phenomenaMods.items")
        .map(mod => `psykana.phenomenaMods.items.${mod}`)
        .filter(mod => valueAt(state, `${mod}.enabled`))
        .reduce((sum, mod) => sum + numberAt(state, `${mod}.value`), 0);
    parts.push({ key: "other", label: "Other", value: other });
    return { power, parts, total: parts.reduce((sum, p) => sum + p.value, 0) };
}
