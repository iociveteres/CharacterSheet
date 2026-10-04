// What a condition changes, line by line, for the title of its name in the
// stat block; the values counted as state/computed.ts counts them.
import { AP_TYPES, ROLL_DOMAINS, optionLabel, optionValue } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { resolveStackExpr, signed } from "../system";
import type { Entry } from "./computed";
import { idsInOrder } from "./gridOrder";

const filled = (s: { value: unknown } | undefined) => String(s?.value ?? "").trim() !== "";

/** What `entry` changes with `stacks` in place of X, or null for an entry that changes nothing. */
export function entrySummary(entry: Entry, stacks: number): string | null {
    const value = (s: { value: unknown } | undefined) => resolveStackExpr(s?.value as string, stacks);
    const name = String(entry.name?.value ?? "").trim();
    switch (entry.type?.value) {
        case "char_bonus": {
            const bonus = value(entry.bonus), unnatural = value(entry.unnaturalBonus);
            const parts = [bonus && signed(bonus), unnatural && `unnatural ${signed(unnatural)}`].filter(Boolean);
            return name && parts.length ? `${name} ${parts.join(", ")}` : null;
        }
        case "char_cap": {
            const cap = value(entry.cap);
            return name && cap > 0 ? `${name} at most ${cap}` : null;
        }
        case "char_override": {
            // A blank field overrides nothing, a 0 sets 0.
            const parts = [
                filled(entry.overrideValue) && `= ${value(entry.overrideValue)}`,
                filled(entry.overrideUnnatural) && `unnatural = ${value(entry.overrideUnnatural)}`,
            ].filter(Boolean);
            return name && parts.length ? `${name} ${parts.join(", ")}` : null;
        }
        case "roll_bonus": {
            const bonus = value(entry.rollBonus);
            if (!name || bonus === 0) return null;
            const mode = entry.domainMode?.value;
            const domains = ROLL_DOMAINS.filter(d => entry.domains?.[d.value]?.value).map(d => d.label);
            return mode && domains.length
                ? `Tests on ${name} ${signed(bonus)} (${mode} ${domains.join(", ")})`
                : `Tests on ${name} ${signed(bonus)}`;
        }
        case "skill_bonus": {
            const bonus = value(entry.skillBonus);
            return name && bonus !== 0 ? `${name} ${signed(bonus)}` : null;
        }
        case "ablative_wounds": {
            const wounds = value(entry.ablativeWounds);
            return wounds !== 0 ? `Ablative wounds ${signed(wounds)}` : null;
        }
        case "initiative_bonus": {
            const bonus = value(entry.initiativeBonus);
            return bonus !== 0 ? `Initiative ${signed(bonus)}` : null;
        }
        case "movement_bonus": {
            const bonus = value(entry.movementBonus);
            return bonus !== 0 ? `Movement ${signed(bonus)}` : null;
        }
        case "bonus_ap": {
            const ap = value(entry.apValue);
            const type = AP_TYPES.find(o => optionValue(o) === entry.apType?.value);
            return ap !== 0 ? `${type ? optionLabel(type) : ""} AP ${signed(ap)}`.trim() : null;
        }
        default:
            return null;
    }
}

/** The lines of what the condition `itemId` changes, in the order of its entries. */
export function conditionSummary(state: SheetSignals, itemId: string): string[] {
    const cond = state.conditions?.list?.items?.[itemId];
    if (!cond) return [];
    // As buildEntryIndex counts them: no stacks are one.
    const stacks = parseInt(String(cond.stacks?.value), 10) || 1;
    return idsInOrder(state, `conditions.list.items.${itemId}.entries.items`)
        .flatMap(id => entrySummary(cond.entries.items[id], stacks) ?? []);
}
