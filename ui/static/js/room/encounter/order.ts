// The turn order of an encounter. The gamemaster's client counts it: only it
// has the sheets of all participants, with their initiative modifiers and
// characteristics. It publishes the order and the view the players see
// (encounterOrder), and the server keeps what it was sent.
import type { InitiativeView } from "./types.gen";

/** A participant as the order sees it. */
export interface Contender {
    participantId: number;
    /** The roll of the sheet plus its modifier; null when it has not rolled. */
    value: number | null;
    /** AgB and Ag, which break ties. */
    agilityBonus: number;
    agility: number;
}

export interface OrderGroup {
    id: number;
    members: Contender[];
}

// More AgB goes first, then more Ag; the first added of equals stays first.
function byAgility(a: Contender, b: Contender): number {
    return b.agilityBonus - a.agilityBonus || b.agility - a.agility || a.participantId - b.participantId;
}

/**
 * The member whose value the group takes: the best of those who rolled, and
 * when none has, the one with the best AgB, who rolls for the group. A mount
 * does not roll, so a character with a mount takes the player's roll.
 */
export function leaderOf(members: readonly Contender[]): Contender | null {
    const rolled = members.filter(m => m.value !== null);
    const pool = rolled.length ? rolled : [...members];
    return pool.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || byAgility(a, b))[0] ?? null;
}

/** The value of the group: its leader's; null when none of it rolled. */
export function groupValue(group: OrderGroup): number | null {
    return leaderOf(group.members)?.value ?? null;
}

/**
 * The groups in turn order, by id: the higher value first, those who have not
 * rolled last; equal values go by the AgB and then the Ag of the members
 * whose values they are, and then by the order the groups were added.
 */
export function sortGroups(groups: readonly OrderGroup[]): number[] {
    const keyed = groups.map(g => ({ id: g.id, leader: leaderOf(g.members) }));
    keyed.sort((a, b) => {
        const va = a.leader?.value ?? null, vb = b.leader?.value ?? null;
        if (va !== vb) {
            if (va === null) return 1;
            if (vb === null) return -1;
            return vb - va;
        }
        if (a.leader && b.leader) {
            const agility = b.leader.agilityBonus - a.leader.agilityBonus || b.leader.agility - a.leader.agility;
            if (agility) return agility;
        }
        return a.id - b.id;
    });
    return keyed.map(k => k.id);
}

/** A group named by the gamemaster goes by its name, the others by their members' names. */
export function groupLabel(name: string | null, memberNames: readonly string[]): string {
    return name?.trim() || memberNames.join(", ");
}

export interface ViewRow {
    groupId: number;
    /** The name the players see. */
    label: string;
    value: number | null;
}

/** What the players see of the order: `rows` in turn order, the current one marked. */
export function initiativeView(round: number, currentGroupId: number | null, rows: readonly ViewRow[]): InitiativeView {
    const current = rows.findIndex(r => r.groupId === currentGroupId);
    return {
        round,
        current: current < 0 ? null : current,
        rows: rows.map(r => ({ name: r.label, value: r.value })),
    };
}
