// Techno Arcana by the rules: the price of a tech power, paid in cognition
// (⚙) before its test and in energy (🗲) only once the test succeeds, and
// the Processes a successful activation holds the power in. What the
// Processes cost each turn is shown, not paid: the sheet has no turns yet.
import { idsInOrder } from "./gridOrder";
import { numberAt, textAt } from "./sync";

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
}

/** What the fields of the tech power at `path` make of it; X is that of its roll. */
export function techTraitsAt(path: string, x = numberAt(`${path}.roll.x`)): TechTraits {
    const process = textAt(`${path}.process`).trim();
    const held = process !== "" && !/^(нет|no|none|[-–—])$/i.test(process);
    return {
        price: parseCost(textAt(`${path}.price`), x),
        process: held ? parseCost(process, x) : null,
        unique: /\(\s*У\s*\)/i.test(process),
        doctrine: /доктрина|doctrin/i.test(textAt(`${path}.subtypes`)),
        auto: /^(автомат|auto)/i.test(textAt(`${path}.test`).trim()),
    };
}

/** The tech powers of the sheet, tab by tab in the order they show. */
export function techPowers(): { path: string; tabId: string }[] {
    return idsInOrder("technoArcana.tabs.items").flatMap(tabId => {
        const tabPath = `technoArcana.tabs.items.${tabId}`;
        return idsInOrder(`${tabPath}.powers.items`).map(id => ({ path: `${tabPath}.powers.items.${id}`, tabId }));
    });
}

export interface ProcessHeld {
    path: string;
    tabId: string;
    name: string;
    copies: number;
    /** What its copies cost each turn together, at the X of its last activation. */
    cost: Cost;
}

export interface Processes {
    powers: ProcessHeld[];
    /** What they cost each turn together, a part rounded up. */
    total: Cost;
}

/** The powers held in Processes. */
export function processes(): Processes {
    const powers: ProcessHeld[] = [];
    for (const { path, tabId } of techPowers()) {
        const copies = numberAt(`${path}.inProcess.copies`);
        if (copies <= 0) continue;
        const cost = techTraitsAt(path, numberAt(`${path}.inProcess.x`)).process ?? { cognition: 0, energy: 0 };
        powers.push({
            path, tabId, copies,
            name: textAt(`${path}.name`).trim() || "Tech Power",
            cost: { cognition: cost.cognition * copies, energy: cost.energy * copies },
        });
    }
    const sum = (key: keyof Cost) => Math.ceil(powers.reduce((total, p) => total + p.cost[key], 0));
    return { powers, total: { cognition: sum("cognition"), energy: sum("energy") } };
}

/**
 * How a successful activation at `x` changes the Processes, by the path of
 * each power it changes: the power takes one more, one at most when it is
 * unique; a Doctrine ends the other Doctrines. Empty for a power without a
 * Process.
 */
export function processAfterActivation(path: string, x: number): Map<string, { copies: number; x?: number }> {
    const traits = techTraitsAt(path, x);
    const changes = new Map<string, { copies: number; x?: number }>();
    if (!traits.process) return changes;
    const copies = numberAt(`${path}.inProcess.copies`);
    changes.set(path, { copies: traits.unique ? 1 : copies + 1, x });
    if (traits.doctrine) {
        for (const other of techPowers()) {
            if (other.path !== path && numberAt(`${other.path}.inProcess.copies`) > 0 && techTraitsAt(other.path).doctrine) {
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
