// The rules of psychic powers the sheet counts: the types a power's subtypes
// name, and the psy rating a cast can take. Reactive when read inside a
// computed.
import { Signal } from "@preact/signals-core";
import { characterState } from "./state";
import { resolvePath } from "./sync";

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

const text = (path: string) => {
    const node = resolvePath(path);
    return node instanceof Signal ? String(node.value ?? "") : "";
};

/** The traits of the power at `powerPath`. */
export const powerTraitsAt = (powerPath: string) => powerTraits(text(`${powerPath}.subtypes`), text(`${powerPath}.sustained`));

const num = (value: unknown) => Number(value) || 0;

/**
 * The PR a normal cast of the power at `powerPath` has: the current PR, or
 * the base PR when a talent lets the power ignore the sustained powers.
 */
export function castCap(powerPath: string): number {
    const psykana = characterState.psykana;
    const talent = resolvePath(`${powerPath}.ignoreTprPenalty`);
    return talent instanceof Signal && talent.value ? num(psykana?.basePR?.value) : num(psykana?.effectivePR?.value);
}

/** The ePR of a safe cast: half the PR of a normal one, rounded up. */
export const safePR = (cap: number) => Math.ceil(cap / 2);
