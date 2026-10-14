// Sorcery, the casting of the half-casters of Pathfinder Crusade (wiki «v
// магия › недоспелкастинг»): a spell typed Sorcery (Bard) takes no PR, has
// no phenomena and pays its Level from a mana pool of its own. One spell is
// sustained at most, two with the talent Expanded Sustain, and casting while
// two are sustained is −10. Rules and decisions: _prd/sheet_kinds/half_casters.md.
import { idsInOrder } from "./gridOrder";
import { isSorcery, powerTraitsAt, psychicPowers, psykanaRule, type SustainedPower } from "./psychic";
import { numberAt, textAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** A talent name as the sheet compares it: case and spaces ignored. */
const talentKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The names of the talents list, as talentKey gives them; not the experience log, where starting talents may be missing. */
export const talentKeys = (state: SheetSignals) =>
    idsInOrder(state, "talents.list.items").map(id => talentKey(textAt(state, `talents.list.items.${id}.name`)));

const EXPANDED_SUSTAIN = ["expanded sustain", "расширенное поддержание"];

/** Whether the talents list has Expanded Sustain. */
export const expandedSustain = (state: SheetSignals) => talentKeys(state).some(name => EXPANDED_SUSTAIN.includes(name));

/** What a Magic test to cast gets while two Sorcery spells are sustained (Expanded Sustain). */
export const SUSTAIN_PENALTY = -10;

export interface SorcerySustained {
    /** In the order of the tabs; they take no PR. */
    powers: SustainedPower[];
    /** The sustained casts, a Repeatable spell's each. */
    count: number;
    /** How many can be sustained: 1, 2 with Expanded Sustain. */
    limit: number;
    /** What a cast's test gets from them: −10 while two are sustained. */
    penalty: number;
    /** The mana their Upkeep costs a turn together. */
    upkeep: number;
}

/**
 * The Sorcery spells marked sustained, while the sheet counts sustained
 * spells (settings.psykana.sustained). Without the spell at `exceptPath`, as
 * while it is cast again.
 */
export function sorcerySustained(state: SheetSignals, exceptPath?: string): SorcerySustained {
    const limit = expandedSustain(state) ? 2 : 1;
    const powers: SustainedPower[] = [];
    const counted = psykanaRule(state, "sustained") ? psychicPowers(state) : [];
    for (const { path, tabId } of counted) {
        if (path === exceptPath || !isSorcery(state, path)) continue;
        const copies = numberAt(state, `${path}.sustain.copies`);
        if (copies <= 0) continue;
        powers.push({
            path, tabId, copies,
            name: textAt(state, `${path}.name`).trim() || "Spell",
            pr: numberAt(state, `${path}.sustain.pr`),
            free: false, overFree: false, taken: 0,
            upkeep: (powerTraitsAt(state, path).upkeep ?? 0) * copies,
        });
    }
    const count = powers.reduce((sum, p) => sum + p.copies, 0);
    return { powers, count, limit, penalty: count >= 2 ? SUSTAIN_PENALTY : 0, upkeep: powers.reduce((sum, p) => sum + p.upkeep, 0) };
}
