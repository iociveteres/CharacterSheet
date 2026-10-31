// Talents of the talents list that add to every weapon of a kind, counted by
// name, English or Russian, as Rapid Reload is (state/reload.ts); wiki «iii
// продвижение › таланты» (_prd/talent_conditions/report.md):
//   Crushing Blow: +½WS.b▲ to the damage of every melee profile;
//   Mighty Shot: +½BS.b▲ to the damage of every ranged attack. The rule
//     leaves out the area of Blast and Spray but not a direct hit at the
//     centre of a Blast: the sheet does not tell them apart and always counts it;
//   Balearic: S.b counts ½A.b▲ higher in the range and damage of thrown
//     weapons, grenades and Primitive ranged weapons, so it adds as much as
//     their S.b terms make of it ("S.b×10м" ten times).
// Each line is named by the talent as listed.
import { WEAPON_REFS, parseDamage, raisedBy, type WeaponMod } from "../damage";
import { THROWN_CLASSES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../system";
import { talentNames } from "./arts";
import { characteristicBonus, characteristicKeys } from "./characteristics";
import { nameKey } from "./magicTest";
import { refValue } from "./resourceStat";
import { textAt } from "./sync";

const CRUSHING_BLOW = ["crushing blow", "крушащий удар"];
const MIGHTY_SHOT = ["mighty shot", "могучий выстрел"];
const BALEARIC = ["balearic", "балеарец"];

/** The talent of the talents list that goes by one of `names`, as listed; undefined without it. */
const listed = (state: SheetSignals, names: readonly string[]) => talentNames(state).find(name => names.includes(nameKey(name)));

const PRIMITIVE = /\bprimitive\b/i;

/**
 * What Balearic adds to the ranged attack at `path` whose range or damage sums
 * `exprs`, named by the talent; null without the talent, for another weapon or
 * with no S.b in them.
 */
export function balearicAt(state: SheetSignals, path: string, exprs: readonly string[]): { add: number; label: string } | null {
    if (!path.startsWith("rangedAttacks.")) return null;
    const label = listed(state, BALEARIC);
    if (!label) return null;
    if (!THROWN_CLASSES.includes(textAt(state, `${path}.class`)) && !PRIMITIVE.test(textAt(state, `${path}.special`))) return null;
    const keys = characteristicKeys(state);
    const terms = exprs.flatMap(e => parseDamage(e, keys, WEAPON_REFS).terms);
    const add = raisedBy(terms, "S", Math.ceil(characteristicBonus(state, "A") / 2), ref => refValue(state, ref));
    return add ? { add, label } : null;
}

/**
 * The modifiers the talents add to the damage of the melee profile or ranged
 * attack at `itemPath`, whose damage is `base` with `mods`; none to its
 * penetration.
 */
export function talentDamageMods(state: SheetSignals, itemPath: string, stat: "damage" | "pen", base: string, mods: readonly WeaponMod[]): WeaponMod[] {
    if (stat !== "damage") return [];
    const mod = (expr: string, label: string | undefined): WeaponMod[] => (label ? [{ expr, enabled: true, label }] : []);
    if (itemPath.startsWith("meleeAttacks.")) return mod("½WS.b▲", listed(state, CRUSHING_BLOW));
    if (!itemPath.startsWith("rangedAttacks.")) return [];
    // The alternative in brackets has the same S.b, as "1d10+S.b [2d10+S.b]".
    const balearic = balearicAt(state, itemPath, [base.split("[")[0], ...mods.filter(m => m.enabled).map(m => m.expr)]);
    return [
        ...mod("½BS.b▲", listed(state, MIGHTY_SHOT)),
        ...(balearic ? mod(signed(balearic.add), balearic.label) : []),
    ];
}
