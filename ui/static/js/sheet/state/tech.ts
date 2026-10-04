// Techno Arcana by the rules: the maximum and restoration of cognition (⚙)
// and energy (🗲), the price of a tech power, paid in ⚙ before its test and
// in 🗲 only once the test succeeds, and the Processes a successful
// activation holds the power in. What a turn restores and the Processes cost
// is shown, not applied: the sheet has no turns yet (_prd/time_system).
import { sheetComputed } from "./state";
import { enabledMods, exprStat, type ResourceModValue, type ResourceStatValue } from "./resourceStat";
import { idsInOrder } from "./gridOrder";
import { numberAt, textAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** A rule the sheet counts for a tech-priest unless its settings turn it off. */
export type TechnoRule = "price" | "processes" | "hardware";

/** Whether the power at `path` can be activated as its Litany allows: compiled, while the sheet counts it. */
export const isCompiledFor = (state: SheetSignals, path: string, traits: TechTraits) =>
    traits.litany === undefined || !technoRule(state, "processes") || numberAt(state, `${path}.compiled`) > 0;

export const technoRule = (state: SheetSignals, rule: TechnoRule) => !!valueAt(state, `settings.technoArcana.${rule}`);

export const COGNITION = "technoArcana.currentCognition";
export const ENERGY = "technoArcana.currentEnergy";

export interface Cost {
    cognition: number;
    energy: number;
}

export interface Price extends Cost {
    /** Whether it counts X, which the player chooses. */
    x: boolean;
}

// An amount and its sign: "2 ⚙", "½ 🗲", "X ⚙" (the rulebooks write a Cyrillic Х too), "1".
const PART = /(?<!\p{L})(½|\d+|[XХ])(?!\p{L})\s*(⚙|🗲)?/gu;

/**
 * A price or Process as the rulebooks write them: "2 ⚙, 1 🗲", "½ ⚙(У)",
 * "X ⚙". An amount without a sign is ⚙; "Нет" and "Да" cost nothing.
 */
export function parseCost(text: string, x: number): Price {
    const price: Price = { cognition: 0, energy: 0, x: false };
    for (const [, amount, sign] of text.matchAll(PART)) {
        const isX = amount === "X" || amount === "Х";
        if (isX) price.x = true;
        const value = isX ? x : amount === "½" ? 0.5 : parseInt(amount, 10);
        if (sign === "🗲") price.energy += value;
        else price.cognition += value;
    }
    return price;
}

export interface TechTraits {
    /** The price of an activation at `x`. */
    price: Price;
    /** What the power costs each turn while in a Process; null when it has no Process. */
    process: Price | null;
    /** (У): held in one Process at most. */
    unique: boolean;
    /** One Doctrine at most among the Processes. */
    doctrine: boolean;
    /** Its test is "Автоматически": activated without a roll. */
    auto: boolean;
    /** Compensator (X): its 🗲 can be lowered by a test on T - 10 × X; 0 when X is missing. */
    compensator?: number;
    /** Litany (X): used only compiled, each compilation a Process of ½X ⚙; 0 when X is missing. */
    litany?: number;
}

const LITANY = /(?:Славословие|Litany)(?:\s*\((\d+)\))?/i;
const COMPENSATOR = /(?:Компенсатор|Compensator)(?:\s*\((\d+)\))?/i;

/** What the fields of the tech power at `path` make of it; X is that of its roll. */
export function techTraitsAt(state: SheetSignals, path: string, x = numberAt(state, `${path}.roll.x`)): TechTraits {
    const process = textAt(state, `${path}.process`).trim();
    const held = process !== "" && !/^(нет|no|none|[-–—])$/i.test(process);
    const subtypes = textAt(state, `${path}.subtypes`);
    const compensator = subtypes.match(COMPENSATOR);
    const litany = subtypes.match(LITANY);
    return {
        ...(compensator && { compensator: parseInt(compensator[1] ?? "0", 10) }),
        ...(litany && { litany: parseInt(litany[1] ?? "0", 10) }),
        price: parseCost(textAt(state, `${path}.price`), x),
        process: held ? parseCost(process, x) : null,
        unique: /\(\s*У\s*\)/i.test(process),
        doctrine: /доктрина|doctrin/i.test(textAt(state, `${path}.subtypes`)),
        auto: /^(автомат|auto)/i.test(textAt(state, `${path}.test`).trim()),
    };
}

/** The tech powers of the sheet, tab by tab in the order they show. */
export function techPowers(state: SheetSignals): { path: string; tabId: string }[] {
    return idsInOrder(state, "technoArcana.tabs.items").flatMap(tabId => {
        const tabPath = `technoArcana.tabs.items.${tabId}`;
        return idsInOrder(state, `${tabPath}.powers.items`).map(id => ({ path: `${tabPath}.powers.items.${id}`, tabId }));
    });
}

export interface ProcessHeld {
    path: string;
    tabId: string;
    name: string;
    /** Held after an activation, or compiled as a Litany. */
    kind: "process" | "compiled";
    copies: number;
    /** What its copies cost each turn together, at the X of its last activation. */
    cost: Cost;
}

export interface Processes {
    powers: ProcessHeld[];
    /** What they cost each turn together, a part rounded up. */
    total: Cost;
}

export interface ProcessCostValue {
    /** What the powers in Processes cost, a part rounded up. */
    base: Cost;
    /** The enabled modifiers that read, in the order of their grid. */
    mods: (ResourceModValue & { resource: keyof Cost })[];
    /** With the modifiers, none under 0. */
    total: Cost;
}

/** What the Processes cost a turn: the powers held in them and the modifiers of talents and implants. */
export function processCost(state: SheetSignals): ProcessCostValue {
    const base = processes(state).total;
    const mods = enabledMods(state, "technoArcana.processCost.mods.items",
        mod => ({ resource: (textAt(state, `${mod}.resource`) === "energy" ? "energy" : "cognition") as keyof Cost }));
    const sum = (key: keyof Cost) => Math.max(0, mods.filter(m => m.resource === key).reduce((n, m) => n + m.value, base[key]));
    return { base, mods, total: { cognition: sum("cognition"), energy: sum("energy") } };
}

/**
 * The ⚙ and 🗲 the Processes lack next turn: what they cost past what the
 * turn leaves, the current value and its restoration up to the maximum; 0
 * when enough.
 */
export function processShortfall(state: SheetSignals): Cost {
    const { total } = processCost(state);
    const short = (current: string, restore: ResourceKey, max: ResourceKey, cost: number) =>
        Math.max(0, cost - Math.min(numberAt(state, current) + resourceStat(state, restore).total, resourceStat(state, max).total));
    return {
        cognition: short(COGNITION, "cognitionRestore", "cognitionMax", total.cognition),
        energy: short(ENERGY, "energyRestore", "energyMax", total.energy),
    };
}

/** What the last activation of a Compensator power paid, which a compensation roll can give back; null once settled. */
export function compensationDue(state: SheetSignals): { name: string; x: number; energy: number; fatigue: number } | null {
    const id = textAt(state, "technoArcana.compensation.power");
    const energy = numberAt(state, "technoArcana.compensation.energy");
    const fatigue = numberAt(state, "technoArcana.compensation.fatigue");
    if (!id || energy + fatigue <= 0) return null;
    const power = techPowers(state).find(p => p.path.endsWith(`.powers.items.${id}`));
    return {
        name: power ? textAt(state, `${power.path}.name`).trim() || "Tech Power" : "A deleted power",
        x: numberAt(state, "technoArcana.compensation.x"),
        energy,
        fatigue,
    };
}

/** The powers held in Processes; one computed for all the powers that show theirs. */
export const processes = sheetComputed((state: SheetSignals): Processes => {
    const powers: ProcessHeld[] = [];
    for (const { path, tabId } of techPowers(state)) {
        const name = textAt(state, `${path}.name`).trim() || "Tech Power";
        const traits = techTraitsAt(state, path, numberAt(state, `${path}.inProcess.x`));
        const copies = numberAt(state, `${path}.inProcess.copies`);
        if (copies > 0) {
            const cost = traits.process ?? { cognition: 0, energy: 0 };
            powers.push({ path, tabId, name, kind: "process", copies, cost: { cognition: cost.cognition * copies, energy: cost.energy * copies } });
        }
        const compiled = traits.litany === undefined ? 0 : numberAt(state, `${path}.compiled`);
        if (compiled > 0) {
            powers.push({ path, tabId, name, kind: "compiled", copies: compiled, cost: { cognition: (traits.litany! / 2) * compiled, energy: 0 } });
        }
    }
    const sum = (key: keyof Cost) => Math.ceil(powers.reduce((total, p) => total + p.cost[key], 0));
    return { powers, total: { cognition: sum("cognition"), energy: sum("energy") } };
});

/**
 * How a successful activation at `x` changes the Processes, by the path of
 * each power it changes: the power takes one more, one at most when it is
 * unique; a Doctrine ends the other Doctrines. Empty for a power without a
 * Process.
 */
export function processAfterActivation(state: SheetSignals, path: string, x: number): Map<string, { copies: number; x?: number }> {
    const traits = techTraitsAt(state, path, x);
    const changes = new Map<string, { copies: number; x?: number }>();
    if (!traits.process) return changes;
    const copies = numberAt(state, `${path}.inProcess.copies`);
    changes.set(path, { copies: traits.unique ? 1 : copies + 1, x });
    if (traits.doctrine) {
        for (const other of techPowers(state)) {
            if (other.path !== path && numberAt(state, `${other.path}.inProcess.copies`) > 0 && techTraitsAt(state, other.path).doctrine) {
                changes.set(other.path, { copies: 0 });
            }
        }
    }
    return changes;
}

/** "2 ⚙, 1 🗲", "½ ⚙"; "0 ⚙" for nothing. */
export function costText({ cognition, energy }: Cost): string {
    const amount = (n: number) => (n === 0.5 ? "½" : Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`);
    const parts = [...(cognition > 0 || energy === 0 ? [`${amount(cognition)} ⚙`] : []), ...(energy > 0 ? [`${amount(energy)} 🗲`] : [])];
    return parts.join(", ");
}

/** A value of cognition or energy that a base and modifiers make (ResourceStat in Go). */
export type ResourceKey = "cognitionMax" | "cognitionRestore" | "energyMax" | "energyRestore";

/**
 * The base of a stat left empty, by the rules: ⚙ up to I.b, ½I.b▲ of it a
 * turn; a Potentia Coil of 3 charges, which a turn does not restore.
 */
export const RESOURCE_DEFAULTS: { readonly [K in ResourceKey]: string } = {
    cognitionMax: "I.b",
    cognitionRestore: "½I.b▲",
    energyMax: "3",
    energyRestore: "0",
};

/** The stat `key` of Techno Arcana. */
export const resourceStat = (state: SheetSignals, key: ResourceKey): ResourceStatValue =>
    exprStat(state, `technoArcana.${key}`, RESOURCE_DEFAULTS[key]);
