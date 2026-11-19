// What a condition changes, line by line, for the title of its name in the
// stat block; the values counted as the topics' computeds count them.
import { AP_TYPES, ROLL_DOMAINS, WEAPON_FIELDS, optionLabel, optionValue } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { isStackExpr, resolveStackExpr } from "../modifiers/entryValues";
import { signed } from "../components/format";
import type { Entry } from "../modifiers/entries";
import { idsInOrder } from "../core/gridOrder";
import { t } from "../../i18n";

const filled = (s: { value: unknown } | undefined) => String(s?.value ?? "").trim() !== "";

/** What `entry` changes with `stacks` in place of X, or null for an entry that changes nothing. */
export function entrySummary(entry: Entry, stacks: number): string | null {
    const value = (s: { value: unknown } | undefined) => resolveStackExpr(s?.value as string, stacks);
    const name = String(entry.name?.value ?? "").trim();
    switch (entry.type?.value) {
        case "char_bonus": {
            const bonus = value(entry.bonus), unnatural = value(entry.unnaturalBonus);
            const parts = [bonus && signed(bonus), unnatural && t("sheet.conditions.summary.unnatural", { value: signed(unnatural) })].filter(Boolean);
            return name && parts.length ? `${name} ${parts.join(", ")}` : null;
        }
        case "char_cap": {
            const cap = value(entry.cap);
            return name && cap > 0 ? t("sheet.conditions.summary.atMost", { name, cap }) : null;
        }
        case "char_cap_bonus": {
            const bonus = value(entry.capBonus);
            return name && bonus !== 0 ? t("sheet.conditions.summary.caps", { name, value: signed(bonus) }) : null;
        }
        case "char_override": {
            // A blank field overrides nothing, a 0 sets 0.
            const parts = [
                filled(entry.overrideValue) && `= ${value(entry.overrideValue)}`,
                filled(entry.overrideUnnatural) && t("sheet.conditions.summary.unnaturalSet", { value: value(entry.overrideUnnatural) }),
            ].filter(Boolean);
            return name && parts.length ? `${name} ${parts.join(", ")}` : null;
        }
        case "roll_bonus": {
            const bonus = value(entry.rollBonus);
            if (!name || bonus === 0) return null;
            const mode = entry.domainMode?.value;
            const domains = ROLL_DOMAINS.filter(d => entry.domains?.[d.value]?.value).map(d => d.label);
            const params = { name, bonus: signed(bonus), domains: domains.join(", ") };
            if (!mode || !domains.length) return t("sheet.conditions.summary.tests", params);
            return mode === "only" ? t("sheet.conditions.summary.testsOnly", params) : t("sheet.conditions.summary.testsExcept", params);
        }
        case "skill_bonus": {
            const bonus = value(entry.skillBonus);
            return name && bonus !== 0 ? `${name} ${signed(bonus)}` : null;
        }
        case "ablative_wounds": {
            const wounds = value(entry.ablativeWounds);
            return wounds !== 0 ? `${t("sheet.terms.stat.ablativeWounds")} ${signed(wounds)}` : null;
        }
        case "initiative_bonus": {
            const bonus = value(entry.initiativeBonus);
            return bonus !== 0 ? `${t("sheet.terms.stat.initiative")} ${signed(bonus)}` : null;
        }
        case "movement_bonus": {
            const bonus = value(entry.movementBonus);
            return bonus !== 0 ? `${t("sheet.terms.stat.movement")} ${signed(bonus)}` : null;
        }
        case "bonus_ap": {
            const ap = value(entry.apValue);
            const type = AP_TYPES.find(o => optionValue(o) === entry.apType?.value);
            return ap !== 0 ? `${type ? optionLabel(type) : ""} AP ${signed(ap)}`.trim() : null;
        }
        case "weapon_bonus": {
            const fieldKey = entry.weaponField?.value || "rng";
            const field = WEAPON_FIELDS.find(o => optionValue(o) === fieldKey);
            const typed = String(entry.weaponBonus?.value ?? "").trim();
            // Dmg and Pen read an expression as their modifiers do (weapons/weaponBonus.ts).
            const expr = (fieldKey === "dmg" || fieldKey === "pen") && !isStackExpr(typed);
            const bonus = value(entry.weaponBonus);
            const text = expr ? (/^[+-]/.test(typed) ? typed : `+${typed}`) : signed(bonus);
            return name && (expr || bonus !== 0) ? `${name}: ${optionLabel(field ?? WEAPON_FIELDS[0])} ${text}` : null;
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
