// The encounter in signals: the gamemaster's (GM mode) and the players'
// (the initiative window). Only remote.ts and actions.ts write them; the
// components render them. The participants' sheets are instances held by
// actions.ts; their signals are read here as the sheet counts them.
import { computed, signal } from "@preact/signals";
import { sheets, sheetsChanged, type SheetInstance } from "../../sheet/instance";
import type { EncounterList, EncounterParticipant, EncounterState, InitiativeView } from "./types.gen";
import { groupLabel, initiativeView as viewOf, leaderOf, sortGroups, type Contender } from "./order";
import { agilityOf, initiativeOf, nameOf } from "./participants";

/** Whether the gamemaster sees the encounter window in place of the sheet. */
export const gmMode = signal(false);
/** The gamemaster's encounters; null for everyone else. */
export const encounterList = signal<EncounterList | null>(null);
/** The encounter the gamemaster has open. */
export const encounter = signal<EncounterState | null>(null);
/** The participant whose card is selected. */
export const selected = signal<number | null>(null);
/** The column whose participants are being picked for a group, and those picked. */
export const grouping = signal<{ npc: boolean; picked: number[] } | null>(null);
export const addSheetsOpen = signal(false);
/** The sheet open over the encounter window. */
export const popupSheetId = signal<string | null>(null);

/** The order of the encounter shown to the players, as everyone sees it. */
export const shownView = signal<InitiativeView | null>(null);
export const initiativeWindowOpen = signal(false);

export interface ParticipantView {
    participant: EncounterParticipant;
    /** Null while its sheet is still on its way. */
    sheet: SheetInstance | null;
    /** The name of the sheet as it is now. */
    name: string;
    /** The name the players see: the display name, else the sheet's. */
    playersName: string;
    contender: Contender;
}

export interface GroupView {
    id: number;
    name: string | null;
    members: ParticipantView[];
    npc: boolean;
    /** Named for the gamemaster and for the players. */
    label: string;
    playersLabel: string;
    value: number | null;
    /** Whose value it is, or who rolls for it. */
    leader: ParticipantView | null;
}

/** The sheet of `sheetId` on the page; follows sheets coming and going. */
export function sheetOf(sheetId: number): SheetInstance | null {
    sheetsChanged.value;
    return sheets.get(String(sheetId)) ?? null;
}

function participantView(participant: EncounterParticipant): ParticipantView {
    const sheet = sheetOf(participant.sheetId);
    const name = (sheet ? nameOf(sheet) : participant.name) || "—";
    return {
        participant,
        sheet,
        name,
        playersName: participant.displayName || name,
        contender: {
            participantId: participant.id,
            value: sheet ? initiativeOf(sheet) : null,
            ...(sheet ? agilityOf(sheet) : { agilityBonus: 0, agility: 0 }),
        },
    };
}

export const participants = computed<ParticipantView[]>(() => encounter.value?.participants.map(participantView) ?? []);

/** The groups of the open encounter in the order the gamemaster's client sorts them. */
export const groups = computed<GroupView[]>(() => {
    const state = encounter.value;
    if (!state) return [];
    const all = participants.value;
    const views = state.groups.map(g => {
        const members = all.filter(p => p.participant.groupId === g.id);
        const leader = leaderOf(members.map(m => m.contender));
        return {
            id: g.id,
            name: g.name,
            members,
            npc: members.every(m => m.participant.npc),
            label: groupLabel(g.name, members.map(m => m.name)),
            playersLabel: groupLabel(g.name, members.map(m => m.playersName)),
            value: leader?.value ?? null,
            leader: members.find(m => m.participant.id === leader?.participantId) ?? null,
        };
    });
    const order = sortGroups(views.map(v => ({ id: v.id, members: v.members.map(m => m.contender) })));
    return order.map(id => views.find(v => v.id === id)!);
});

/** Whether the sheets of all participants are on the page, so the order counts them all. */
export const allSheetsHere = computed(() => participants.value.every(p => p.sheet));

/** The order to publish: positions by group id, and the view of the players. */
export const publishedOrder = computed(() => {
    const state = encounter.value;
    const ordered = groups.value;
    const positions: { [groupId: number]: number } = {};
    ordered.forEach((g, i) => positions[g.id] = i);
    return {
        positions,
        view: viewOf(state?.round ?? 1, state?.currentGroupId ?? null,
            ordered.map(g => ({ groupId: g.id, label: g.playersLabel, value: g.value }))),
    };
});

/** The name the players see a roll of sheet `sheetId` under, when the gamemaster gave its participant one. */
export function displayNameOf(sheetId: string): string | null {
    const p = encounter.peek()?.participants.find(p => String(p.sheetId) === sheetId);
    return p?.displayName || null;
}
