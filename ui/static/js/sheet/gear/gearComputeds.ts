// The computeds of carrying: what the character can carry, lift and push by
// the carry weight base, and the weight of what it carries.
import { computed } from "@preact/signals-core";
import { coinsWeight } from "./coinRules";
import { gearWeight } from "./gearItem";
import type { SheetSignals } from "../schema/sheet";

const CARRY_WEIGHT_TABLE = [
    0.9, 2.25, 4.5, 9, 18, 27, 36, 45, 56, 67, 78, 90, 112, 225, 337, 450,
    675, 900, 1350, 1800, 2250, 2700, 3150, 3600, 4050, 4500, 4950, 5400,
    5850, 6300, 6750, 7200, 7650, 8100, 8550, 9000, 9450, 9900, 10350,
    10800, 11250, 11700, 12150, 12600, 13050, 13500,
];
const LIFT_WEIGHT_TABLE = [
    2.25, 4.5, 9, 18, 36, 54, 72, 90, 112, 135, 157, 180, 225, 450, 675, 900,
    1350, 1800, 2700, 3600, 4500, 5400, 6300, 7200, 8100, 9000, 9900, 10800,
    11700, 12600, 13500, 14400, 15300, 16200, 17100, 18000, 18900, 19800,
    20700, 21600, 22500, 23400, 24300, 25200, 26100, 27000,
];
const PUSH_WEIGHT_TABLE = [
    4.5, 9, 18, 36, 72, 108, 144, 180, 225, 270, 315, 360, 450, 900, 1350,
    1800, 2700, 3600, 5400, 7200, 9000, 10800, 12600, 14400, 16200, 18000,
    19800, 21600, 23400, 25200, 27000, 28800, 30600, 32400, 34200, 36000,
    37800, 39600, 41400, 43200, 45000, 46800, 48600, 50400, 52200, 54000,
];

export function attachGearComputeds(state: SheetSignals): void {
    const base = () => Number(state.carryWeightAndEncumbrance?.carryWeightBase?.value) || 0;
    Object.assign(state.carryWeightAndEncumbrance, {
        carryWeight: computed(() => {
            const b = base();
            if (b > 45) return "too";
            if (b < 0) return "such";
            return CARRY_WEIGHT_TABLE[b];
        }),
        liftWeight: computed(() => {
            const b = base();
            if (b > 45) return "strong";
            if (b < 0) return "a puny";
            return LIFT_WEIGHT_TABLE[b];
        }),
        pushWeight: computed(() => {
            const b = base();
            if (b > 45) return "to hold!";
            if (b < 0) return "weakling!";
            return PUSH_WEIGHT_TABLE[b];
        }),
        encumbrance: computed(() => {
            let total = 0;
            for (const id in (state.gear?.list?.items ?? {})) {
                const item = state.gear.list.items[id];
                if (!item.carried?.value) continue;
                total += Math.round(gearWeight(item).total * 1000);
            }
            return (total + Math.round(coinsWeight(state) * 1000)) / 1000;
        }),
    });
}
