// What makes up the armour of a body part, line by line, for the titles of
// the totals in the Armour block and the stat block (components/hoverTitle.ts).
import { AP_TYPES, optionLabel, optionValue, type BodyPartKey } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../system";
import type { ApSource, ArmourComputeds } from "./armour";

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;
const AP_TYPE_LABELS = new Map(AP_TYPES.map(o => [optionValue(o), optionLabel(o)]));

/** A source of AP of a category; a manual field is named by its type. */
function sourceLine(s: ApSource): string {
    const type = AP_TYPE_LABELS.get(s.apType) || s.apType;
    return `${s.name === null ? type : `${s.name} (${type})`} ${signed(s.ap)}`;
}

/** The toughness bonus and the daemonic AP, which the small mark of a part shows. */
export function toughnessSummary(state: SheetSignals, armour: ArmourComputeds): string[] {
    const t = num(state.characteristics?.T?.calculatedValue);
    const unnatural = num(state.characteristics?.T?.calculatedUnnatural);
    const daemonic = armour.misc.value.filter(s => s.apType === "daemonic");
    const mark = armour.toughnessBase.value + daemonic.reduce((sum, s) => sum + s.ap, 0);
    return [
        daemonic.length ? `Toughness bonus and daemonic armour ${mark}` : `Toughness bonus ${mark}`,
        // As calculateCharacteristicBase counts it.
        `T ${t}: ${signed(Math.floor(Math.min(t, 100) / 10))}`,
        ...(unnatural ? [`Unnatural T ${signed(unnatural)}`] : []),
        ...daemonic.map(sourceLine),
    ];
}

/** The total damage absorption of `part` and everything that adds to it. */
export function armourTotalSummary(state: SheetSignals, armour: ArmourComputeds, part: BodyPartKey): string[] {
    const p = armour.parts[part];
    const own = state.armour?.[part];
    const gear = p.gearArmour.value;
    // Worn armour gear replaces the part's own armour: the best piece counts.
    const worn = gear === null ? null : p.pieces.value.find(piece => piece.ap === gear)!;
    const extras = ([1, 2] as const)
        .map(n => ({ name: String(own?.[`extra${n}Name`]?.value ?? "").trim() || `Extra ${n}`, ap: num(own?.[`extra${n}Value`]) }))
        .filter(e => e.ap);
    return [
        `Total damage absorption ${p.total.value}`,
        ...(worn ? [`${worn.name} ${signed(gear!)}`] : num(own?.armourValue) ? [`Armour ${signed(num(own?.armourValue))}`] : []),
        ...extras.map(e => `${e.name} ${signed(e.ap)}`),
        ...p.shields.value.map(s => `${s.name} (shield) ${signed(s.ap)}`),
        ...(armour.toughnessBase.value ? [`Toughness bonus ${signed(armour.toughnessBase.value)}`] : []),
        ...armour.misc.value.map(sourceLine),
    ];
}

/** The super armour of `part`, what it does and where it comes from. */
export function superArmourSummary(armour: ArmourComputeds, part: BodyPartKey): string[] {
    const p = armour.parts[part];
    const value = p.superArmourSub.value;
    // Worn armour gear replaces the part's own super armour: the best piece counts.
    const from = value ? p.pieces.value.find(piece => piece.superAp === value) : undefined;
    return [
        `Super armour ${value}: damage of a lower pen is halved, rounded up, before absorption`,
        ...(from ? [`${from.name} ${value}`] : []),
    ];
}
