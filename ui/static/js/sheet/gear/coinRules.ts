// The coins of a Pathfinder Crusade character (gear/Coins.tsx): their
// weight, unless turned off, goes into the encumbrance (gear/gearComputeds.ts).
import { t } from "../../i18n";
import type { SheetSignals } from "../schema/sheet";
import { numberAt, valueAt } from "../core/sync";

export const COINS = [
    { key: "pp", label: "PP", title: t("sheet.termsPf.coin.pp") },
    { key: "gp", label: "GP", title: t("sheet.termsPf.coin.gp") },
    { key: "sp", label: "SP", title: t("sheet.termsPf.coin.sp") },
    { key: "cp", label: "CP", title: t("sheet.termsPf.coin.cp") },
] as const;

/** Pathfinder's 50 coins to a pound, rounded to the kilogram. */
export const COINS_PER_KG = 100;

export const coinCount = (state: SheetSignals) => COINS.reduce((n, c) => n + numberAt(state, `coins.${c.key}`), 0);

/** Whether the coins weigh; false on a sheet without coins. */
export const coinsWeigh = (state: SheetSignals) => !!valueAt(state, "coins.countWeight");

/** What the coins weigh in kg, 0 while they do not count. */
export const coinsWeight = (state: SheetSignals) => (coinsWeigh(state) ? coinCount(state) / COINS_PER_KG : 0);
