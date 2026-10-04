// The columns of the characters and of the NPCs: a card for each participant
// with its wounds, the groups framed, and the column's buttons below.
import { useRef, useState } from "preact/hooks";
import { grouping, groups, selected, type GroupView, type ParticipantView } from "../state";
import {
    changeWounds, duplicateNpc, newNpc, openPopup, removeParticipant, selectParticipant, setAddSheetsOpen, setDisplayName,
    setFromBestiaryOpen, toggleGrouping, togglePicked, ungroup,
} from "../actions";
import { openAddVariant, openSaveToCollection } from "../../bestiary/actions";
import { woundsOf } from "../participants";
import { sheetKinds } from "../../state";
import { useClickOutside } from "../../components/useClickOutside";
import type { SheetKind } from "../../../sheet/kinds/kinds.gen";

export function ParticipantColumn({ npc }: { npc: boolean }) {
    const mine = groups.value.filter(g => g.npc === npc && g.members.length);
    const picking = grouping.value?.npc === npc;
    return (
        <div class={picking ? "encounter-column participant-column picking" : "encounter-column participant-column"}
            data-column={npc ? "npc" : "players"}>
            <div class="encounter-column-body">
                <p class="encounter-column-title">{npc ? "NPC" : "Players"}</p>
                {mine.map(g => g.members.length > 1
                    ? <Group key={g.id} group={g} />
                    : <Card key={g.members[0].participant.id} p={g.members[0]} />)}
            </div>
            <div class="encounter-column-footer">
                {npc && (
                    <button type="button" class="button-colored encounter-from-bestiary" onClick={() => setFromBestiaryOpen(true)}>From bestiary</button>
                )}
                {npc ? <NewNpc /> : (
                    <button type="button" class="button-colored encounter-add-sheets" onClick={() => setAddSheetsOpen(true)}>Add sheets</button>
                )}
                <button type="button" class={picking ? "encounter-group button-colored" : "encounter-group"} onClick={() => toggleGrouping(npc)}>
                    {picking ? "Join the picked" : "Group"}
                </button>
            </div>
        </div>
    );
}

function Group({ group }: { group: GroupView }) {
    return (
        <div class="encounter-group-frame" data-group-id={group.id}>
            <div class="encounter-group-header">
                <span>{group.label} · {group.value ?? "—"}</span>
                <button type="button" class="encounter-ungroup" title="Ungroup" aria-label="Ungroup" onClick={() => ungroup(group.id)}>⤫</button>
            </div>
            {group.members.map(m => <Card key={m.participant.id} p={m} />)}
        </div>
    );
}

function Card({ p }: { p: ParticipantView }) {
    const { participant, sheet } = p;
    const pick = grouping.value;
    const picking = pick?.npc === participant.npc;
    const wounds = sheet ? woundsOf(sheet) : null;
    const classes = ["encounter-card", selected.value === participant.id && "selected"].filter(Boolean).join(" ");
    const onClick = (e: MouseEvent) => {
        if ((e.target as Element).closest("button, input, .encounter-card-menu")) return;
        if (picking) togglePicked(participant.id);
        else selectParticipant(participant.id);
    };
    return (
        <div class={classes} data-participant-id={participant.id} data-sheet-id={participant.sheetId} onClick={onClick}>
            <div class="encounter-card-name">
                {picking && (
                    <input type="checkbox" class="encounter-pick" aria-label={`Pick ${p.name}`}
                        checked={pick.picked.includes(participant.id)} onChange={() => togglePicked(participant.id)} />
                )}
                <span class="encounter-card-title">{p.name}</span>
            </div>
            {participant.displayName && <div class="encounter-card-shown-as">for players: {participant.displayName}</div>}
            <div class="encounter-card-wounds">
                <button type="button" class="encounter-wounds-minus" title="Take a wound" aria-label="Take a wound"
                    disabled={!sheet} onClick={() => changeWounds(participant.id, -1)}>−</button>
                <span class="encounter-wounds-value">{wounds ? `${wounds.left}/${wounds.max}` : "…"}</span>
                <button type="button" class="encounter-wounds-plus" title="Heal a wound" aria-label="Heal a wound"
                    disabled={!sheet} onClick={() => changeWounds(participant.id, 1)}>+</button>
                <span class="spacer" />
                <button type="button" class="encounter-open-sheet" title="Open the sheet" aria-label="Open the sheet"
                    disabled={!sheet} onClick={() => openPopup(participant.sheetId)}>↗</button>
                {participant.npc && <NpcMenu p={p} />}
                <button type="button" class="encounter-remove" title="Remove from the encounter" aria-label="Remove from the encounter"
                    onClick={() => void removeParticipant(participant.id)}>×</button>
            </div>
            {wounds && (
                <div class="encounter-wounds-bar">
                    <i style={{ width: `${wounds.max > 0 ? Math.max(0, Math.min(1, wounds.left / wounds.max)) * 100 : 0}%` }} />
                </div>
            )}
        </div>
    );
}

/** Copies of the NPC, the name the players see it under, and the NPC in the bestiary. */
function NpcMenu({ p }: { p: ParticipantView }) {
    const [open, setOpen] = useState(false);
    const [count, setCount] = useState(1);
    const [shownAs, setShownAs] = useState(p.participant.displayName ?? "");
    const box = useRef<HTMLSpanElement>(null);
    useClickOutside(box, open, () => setOpen(false));
    // Copied from a creature of the gamemaster's own collection.
    const sourceName = p.participant.sourceCreatureId !== null ? p.participant.sourceCreatureName ?? "" : null;
    const toggle = () => {
        setShownAs(p.participant.displayName ?? "");
        setOpen(!open);
    };
    return (
        <span class="encounter-card-menu" ref={box}>
            <button type="button" class="encounter-npc-menu-btn" title="NPC menu" aria-label="NPC menu" aria-expanded={open} onClick={toggle}>⋯</button>
            {open && (
                <div class="encounter-menu encounter-npc-menu" role="menu">
                    <label class="layout-row">
                        Duplicate ×
                        <input type="number" min={1} max={20} value={count} class="encounter-duplicate-count"
                            onInput={e => setCount(Math.max(1, Math.min(20, Number(e.currentTarget.value) || 1)))} />
                        <button type="button" class="encounter-duplicate" onClick={() => {
                            setOpen(false);
                            duplicateNpc(p.participant.id, count);
                        }}>Copy</button>
                    </label>
                    <label class="layout-column">
                        Name for players
                        <span class="layout-row">
                            <input class="encounter-display-name" value={shownAs} maxLength={100} placeholder={p.name}
                                onInput={e => setShownAs(e.currentTarget.value)}
                                onKeyDown={e => {
                                    if (e.key !== "Enter") return;
                                    setOpen(false);
                                    setDisplayName(p.participant.id, shownAs);
                                }} />
                            <button type="button" class="encounter-display-name-save" onClick={() => {
                                setOpen(false);
                                setDisplayName(p.participant.id, shownAs);
                            }}>Save</button>
                        </span>
                    </label>
                    <button type="button" class="encounter-save-to-collection" onClick={() => {
                        setOpen(false);
                        openSaveToCollection(p.participant.sheetId, p.name);
                    }}>Save to collection</button>
                    {sourceName !== null && (
                        <button type="button" class="encounter-add-variant" title={`A new creature next to "${sourceName}"`} onClick={() => {
                            setOpen(false);
                            openAddVariant(p.participant.sheetId, p.name, sourceName);
                        }}>Add variant to bestiary…</button>
                    )}
                </div>
            )}
        </span>
    );
}

function NewNpc() {
    const [kind, setKind] = useState<SheetKind>(sheetKinds[0]?.kind ?? "black_crusade");
    return (
        <div class="layout-row encounter-new-npc">
            {sheetKinds.length > 1 && (
                <select value={kind} aria-label="Kind of the new NPC" onChange={e => setKind(e.currentTarget.value as SheetKind)}>
                    {sheetKinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
            )}
            <button type="button" class="button-colored encounter-new-npc-btn" onClick={() => newNpc(kind)}>New NPC</button>
        </div>
    );
}
