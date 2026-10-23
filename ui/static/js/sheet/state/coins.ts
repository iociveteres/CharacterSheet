// The coins of a Pathfinder Crusade character (blocks/Coins.tsx): their
// weight, unless turned off, goes into the encumbrance (state/computed.ts).
import type { SheetSignals } from "../schema/sheet";
import { numberAt, valueAt } from "./sync";

export const COINS = [
    { key: "pp", label: "PP", title: "Platinum pieces" },
    { key: "gp", label: "GP", title: "Gold pieces" },
    { key: "sp", label: "SP", title: "Silver pieces" },
    { key: "cp", label: "CP", title: "Copper pieces" },
] as const;

/** Pathfinder's 50 coins to a pound, rounded to the kilogram. */
export const COINS_PER_KG = 100;

export const coinCount = (state: SheetSignals) => COINS.reduce((n, c) => n + numberAt(state, `coins.${c.key}`), 0);

/** Whether the coins weigh; false on a sheet without coins. */
export const coinsWeigh = (state: SheetSignals) => !!valueAt(state, "coins.countWeight");

/** What the coins weigh in kg, 0 while they do not count. */
export const coinsWeight = (state: SheetSignals) => (coinsWeigh(state) ? coinCount(state) / COINS_PER_KG : 0);
