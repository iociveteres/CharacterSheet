// The grips of a melee weapon (rulebook «II. Механика › Бой › Хваты»): its
// grip string, "основной [альтернативы]" in Russian or English, and what the
// grip held changes in its profile. state/melee.ts applies the effects to the
// weapon's Range, Balance, damage and attacks.

export type GripKey = "1h" | "2h" | "Fa" | "Pa" | "Rev" | "Cl" | "Fist" | "Mh" | "Leg" | "Head" | "Tail";

/** The grips in the order of the rulebook, which also orders the parts of a combined grip. */
export const GRIP_KEYS: readonly GripKey[] = ["1h", "2h", "Fa", "Pa", "Rev", "Cl", "Fist", "Mh", "Leg", "Head", "Tail"];

// The rulebook's abbreviations; the English keys read as well.
const RUSSIAN: { [word: string]: GripKey } = {
    "1р": "1h", "2р": "2h", "п": "Fa", "л": "Pa", "об": "Rev", "бл": "Cl", "кл": "Fist", "мх": "Mh", "ног": "Leg", "гол": "Head", "хв": "Tail",
};
const WORDS: ReadonlyMap<string, GripKey> = new Map([
    ...Object.entries(RUSSIAN),
    ...GRIP_KEYS.map(key => [key.toLowerCase(), key] as const),
]);

/** A grip the weapon can be held in: one of the table, or several joined by "+", as "1h+Rev". */
export interface Grip {
    /** What `gripSelected` stores and the chip shows: the keys joined by "+", or the string as typed when it reads as no grip. */
    id: string;
    /** Empty for a string that reads as no grip: it has no effects. */
    keys: GripKey[];
}

/** One grip as typed, "1р+Об" or "Л+П"; null when a part is no grip. */
function parseGrip(text: string): Grip | null {
    const keys: GripKey[] = [];
    for (const part of text.split("+")) {
        const key = WORDS.get(part.trim().toLowerCase());
        if (!key) return null;
        if (!keys.includes(key)) keys.push(key);
    }
    keys.sort((a, b) => GRIP_KEYS.indexOf(a) - GRIP_KEYS.indexOf(b));
    return { id: keys.join("+"), keys };
}

// The primary grip and the alternatives in square or round brackets.
const GRIP_STRING = /^([^[\]()]*?)\s*(?:[[(]([^[\]()]*)[\])])?$/;

/**
 * The grips of the string `text`: the primary first, then the alternatives,
 * each once. A string that does not read is one grip as typed, without
 * effects; an empty one has none.
 */
export function parseGrips(text: string): Grip[] {
    const typed = text.trim();
    if (!typed) return [];
    const asTyped = [{ id: typed, keys: [] }];
    const m = typed.match(GRIP_STRING);
    if (!m || !m[1]) return asTyped;
    const parts = [m[1], ...(m[2]?.split(",") ?? [])].map(part => part.trim()).filter(Boolean);
    const grips: Grip[] = [];
    for (const part of parts) {
        const grip = parseGrip(part);
        if (!grip) return asTyped;
        if (!grips.some(g => g.id === grip.id)) grips.push(grip);
    }
    return grips;
}

/** A change of a value: added, or set outright. */
export type Step = { label: string; add: number } | { label: string; set: number };

/** A change of the Range: of both ends, or of its minimum or maximum alone. */
export type RangeStep = Step & { end: "both" | "min" | "max" };

/** What the grip held changes in the weapon. */
export interface GripEffects {
    range: RangeStep[];
    balance: Step[];
    /** Damage modifiers, in the expressions of damage.ts; "die" is the die 1h takes away. */
    damage: { label: string; expr: string | "die" }[];
    /** Whether the S.b modifiers of the damage count half, rounded up (Rev). */
    halfStrength: boolean;
    /** What the WS tests with the weapon get. */
    ws: { label: string; add: number }[];
    /** Properties the weapon gets, as "Precise". */
    properties: string[];
    /** The profiles the weapon can use; null for all. */
    profiles: readonly string[] | null;
    /** Whether the weapon uses the profile of the one-handed Mace (Mordhau). */
    mace: boolean;
}

/** The profile a weapon held in Mordhau uses: that of the one-handed Mace. */
export const MACE_PROFILE = {
    profile: "mace", range: "3", damage: "1d10+1", pen: "0", damageType: "I(Cr)", special: "Imprecise, Primitive", balance: -1,
} as const;

/** The profiles the Fist grip allows. */
export const FIST_PROFILES: readonly string[] = ["axe", "hook", "hammer"];

/**
 * The effects of `grip` on a weapon whose primary grip is `primary`; a
 * spear's 1h and Rev are milder. 1h and 2h count only as an alternative: the
 * primary grip is the weapon as the rulebook describes it.
 */
export function gripEffects(grip: Grip, primary: Grip, spear: boolean): GripEffects {
    const fx: GripEffects = { range: [], balance: [], damage: [], halfStrength: false, ws: [], properties: [], profiles: null, mace: false };
    const has = (key: GripKey) => grip.keys.includes(key);
    const alternative = (key: GripKey) => has(key) && !primary.keys.includes(key);
    if (alternative("1h")) {
        fx.damage.push(spear ? { label: "1h, spear", expr: "-1" } : { label: "1h", expr: "die" });
        fx.balance.push({ label: spear ? "1h, spear" : "1h", add: spear ? -2 : -1 });
        fx.ws.push({ label: "1h", add: -5 });
        fx.range.push({ label: "1h", add: 1, end: "both" });
    }
    if (alternative("2h")) fx.damage.push({ label: "2h", expr: "+3" });
    if (has("Rev")) {
        fx.range.push({ label: "Rev", add: -2, end: "both" });
        fx.ws.push({ label: "Rev", add: -10 });
        fx.halfStrength = !spear;
    }
    if (has("Cl")) {
        fx.range.push({ label: "Cl", add: -2, end: "both" });
        fx.properties.push("Precise");
        fx.balance.push({ label: "Cl", set: -2 });
    }
    if (has("Fist")) {
        fx.range.push({ label: "Fist", set: 0, end: "both" });
        fx.damage.push({ label: "Fist", expr: "-2" });
        fx.profiles = FIST_PROFILES;
    }
    if (has("Mh")) {
        fx.mace = true;
        // The Mace is one-handed: in two hands it gets what 2h gives.
        fx.damage.push({ label: "Mh, 2h", expr: "+3" });
        fx.ws.push({ label: "Mh", add: -5 });
    }
    if (has("Tail")) {
        fx.range.push({ label: "Tail", set: 0, end: "min" });
        fx.balance.push({ label: "Tail", set: -2 });
        fx.properties.push("Cheap Shot");
    }
    return fx;
}

const GRIP_TITLES: { [K in GripKey]: string } = {
    "1h": "One-handed. As an alternative grip: one die less (−4 Dmg with a single die), Balance −1, WS −5, Rng +1; a spear: −1 Dmg, Balance −2",
    "2h": "Two-handed. As an alternative grip: +3 Dmg, +10 to Stun and Knock Down",
    Fa: "Forearm: the hand stays free; putting it on or off takes a Full Action, it cannot be disarmed",
    Pa: "Palm: the hand holds only what is modified for it; putting it on or off takes a Full Action, it cannot be disarmed",
    Rev: "Reverse: Rng −2 (min 0), WS −10 but Feint +10 and Lunge without it, ½S.b▲ to damage (not a spear); can be thrown at S.b×1м, BS −10",
    Cl: "Close: Rng −2 (min 0), Precise, Balance −2; cannot Grapple",
    Fist: "Fist: Rng 0, −2 Dmg, counts as a fist; only the axe, hook and hammer profiles",
    Mh: "Mordhau: the one-handed Mace profile (Rng 3, 1d10+1, Pen 0, I(Cr), Imprecise, Primitive, Balance −1) in two hands: +3 Dmg; WS −5",
    Leg: "Leg: a turn attacks with the arms or the legs, not both; a free kick (+20) at a smaller prone foe walked over",
    Head: "Head: a separate odd limb, as Multiple Arms (+1); one head weapon attacks a turn",
    Tail: "Tail: min Rng 0, Balance −2, Cheap Shot",
};

/** What a chip's title says of `grip`: each of its grips; an unread string says so. */
export const gripTitle = (grip: Grip): string =>
    (grip.keys.length ? grip.keys.map(key => GRIP_TITLES[key]).join("\n") : "Reads as no grip: it changes nothing");
