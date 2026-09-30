// The rules of psychic powers the sheet counts: the types a power's subtypes
// name, the psy rating a cast can take, the sustained powers and the
// phenomena. Reactive when read inside a computed.
import { characteristicBonus } from "./characteristics";
import { idsInOrder } from "./gridOrder";
import { numberAt, textAt, valueAt } from "./sync";

export interface PowerTraits {
    /** Whether the power can be sustained: its Sustained field names an action. */
    sustainable: boolean;
    /** Cycle (X): sustaining it may be free when cast at ePR X or more; null when X is not given. */
    cycle?: number | null;
    /** Repeatable (X): X casts are sustained at once, the ones after them are not. */
    repeatable?: number | null;
}

// What the Sustained field of a power that cannot be sustained says.
const NOT_SUSTAINED = new Set(["", "нет", "no", "none", "-", "–", "—"]);

const TYPE = /^(цикл|cycle|повторяемая|repeatable)\s*(?:\(\s*(\d+)\s*\))?$/i;

/** The traits of a power from its Subtypes ("Призыв, Цикл (5)") and Sustained fields. */
export function powerTraits(subtypes: string, sustained: string): PowerTraits {
    const traits: PowerTraits = { sustainable: !NOT_SUSTAINED.has(sustained.trim().toLowerCase()) };
    for (const part of subtypes.split(",")) {
        const m = part.trim().match(TYPE);
        if (!m) continue;
        const x = m[2] === undefined ? null : parseInt(m[2], 10);
        if (/^(цикл|cycle)$/i.test(m[1])) traits.cycle = x;
        else traits.repeatable = x;
    }
    return traits;
}

/** The traits of the power at `powerPath`. */
export const powerTraitsAt = (powerPath: string) => powerTraits(textAt(`${powerPath}.subtypes`), textAt(`${powerPath}.sustained`));

export type PsykanaRule = "sustained" | "cycle" | "phenomena";

/** Whether the sheet counts `rule` (settings.psykana). */
export const psykanaRule = (rule: PsykanaRule) => !!valueAt(`settings.psykana.${rule}`);

/** The psychic powers of the sheet, tab by tab in the order they show. */
export function psychicPowers(): { path: string; tabId: string; tabPath: string }[] {
    return idsInOrder("psykana.tabs.items").flatMap(tabId => {
        const tabPath = `psykana.tabs.items.${tabId}`;
        return idsInOrder(`${tabPath}.powers.items`).map(id => ({ path: `${tabPath}.powers.items.${id}`, tabId, tabPath }));
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
}

export interface Sustained {
    powers: SustainedPower[];
    /** What they take from the PR together. */
    taken: number;
    /** How many powers Cycle can sustain free: ½I.b▲. */
    freeLimit: number;
}

/**
 * The powers marked sustained and what they take from the PR: one per copy,
 * but those cast free by Cycle, as many as ½I.b▲, in the order of the tabs.
 * Without the power at `exceptPath`, as while it is cast again.
 */
export function sustainedPowers(exceptPath?: string): Sustained {
    const freeLimit = Math.ceil(characteristicBonus("I") / 2);
    const cycle = psykanaRule("cycle");
    let freeLeft = freeLimit;
    const powers: SustainedPower[] = [];
    for (const { path, tabId } of psychicPowers()) {
        if (path === exceptPath) continue;
        const copies = numberAt(`${path}.sustain.copies`);
        if (copies <= 0) continue;
        const castFree = cycle && !!valueAt(`${path}.sustain.free`);
        const free = castFree && freeLeft > 0;
        if (free) freeLeft--;
        powers.push({
            path, tabId, copies, free,
            name: textAt(`${path}.name`).trim() || "Psychic Power",
            pr: numberAt(`${path}.sustain.pr`),
            overFree: castFree && !free,
            taken: free ? 0 : copies,
        });
    }
    return { powers, taken: powers.reduce((sum, p) => sum + p.taken, 0), freeLimit };
}

/**
 * The sustained powers as the rules count them: those marked while the sheet
 * counts them (settings.psykana.sustained), Sustained Powers as typed
 * otherwise. The marked ones leave out the power at `exceptPath`, which the
 * typed number cannot.
 */
export function sustaining(exceptPath?: string): { taken: number; any: boolean } {
    if (!psykanaRule("sustained")) {
        const typed = numberAt("psykana.sustainedPowers");
        return { taken: typed, any: typed > 0 };
    }
    const { powers, taken } = sustainedPowers(exceptPath);
    // A power sustained free by Cycle takes no PR, but it is sustained.
    return { taken, any: powers.length > 0 };
}

/**
 * The PR a normal cast of the power at `powerPath` has: the current PR, or
 * the base PR when a talent lets the power ignore the sustained powers. A
 * power cast again ends its own sustaining first, unless it is Repeatable;
 * a power past the free ones of Cycle may then become free.
 */
export function castCap(powerPath: string): number {
    if (valueAt(`${powerPath}.ignoreTprPenalty`)) return numberAt("psykana.basePR");
    const except = powerTraitsAt(powerPath).repeatable === undefined ? powerPath : undefined;
    return numberAt("psykana.basePR") - sustaining(except).taken;
}

/**
 * How a cast of `pr` that succeeded changes the sustaining of the power at
 * `powerPath`, or null when it does not: another power replaces its own
 * sustained cast; a Repeatable (X) one adds a copy until X are sustained.
 */
export function sustainAfterCast(powerPath: string, pr: number, free: boolean): { copies: number; pr: number; free: boolean } | null {
    const { repeatable } = powerTraitsAt(powerPath);
    if (repeatable === undefined) return { copies: 1, pr, free };
    const copies = numberAt(`${powerPath}.sustain.copies`);
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

/**
 * What the phenomena roll adds to 1d100: the kick of the last cast by the
 * nature of the gift (Bound +10, Unbound +5 and Daemonic +10 per point), the
 * sustained powers, the last power's own modifier and the other ones.
 */
export function phenomena(): Phenomena {
    const id = textAt("psykana.lastCastPower");
    const path = id ? psychicPowers().find(p => p.path.endsWith(`.powers.items.${id}`))?.path : undefined;
    const power = path ? {
        path,
        name: textAt(`${path}.name`).trim() || "Psychic Power",
        kick: numberAt(`${path}.cast.kick`),
        safe: !!valueAt(`${path}.cast.safe`),
        reason: textAt(`${path}.cast.phenomena`) as PhenomenaReason,
    } : null;

    const nature = textAt("psykana.psykanaType");
    const kick = power && !power.safe ? power.kick : 0;
    const natureValue = kick <= 0 ? 0 : nature === "Bound" ? 10 : nature === "Unbound" ? 5 * kick : nature === "Daemonic" ? 10 * kick : 0;

    const parts: PhenomenaPart[] = [
        { key: "nature", label: kick > 0 ? `${nature || "Nature"}, kick ${kick}` : "Kick", value: natureValue },
        { key: "sustained", label: "Sustained powers", value: sustaining().any ? numberAt("psykana.sustainPenalty") : 0 },
        { key: "power", label: power ? `${power.name}'s own` : "The power's own", value: power ? numberAt(`${path}.phenomenaMod`) : 0 },
    ];
    const other = idsInOrder("psykana.phenomenaMods.items")
        .map(mod => `psykana.phenomenaMods.items.${mod}`)
        .filter(mod => valueAt(`${mod}.enabled`))
        .reduce((sum, mod) => sum + numberAt(`${mod}.value`), 0);
    parts.push({ key: "other", label: "Other", value: other });
    return { power, parts, total: parts.reduce((sum, p) => sum + p.value, 0) };
}
