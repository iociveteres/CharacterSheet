// The columns "Party" and "Enemies": a card for each participant with its
// wounds, the groups framed, and the column's buttons below. A card is dragged
// into the other column by anywhere but its buttons and fields.
import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { addSheetsOpen, columnGroups, encounter, grouping, selected, undoableRemovals, type GroupView, type ParticipantView, type Side } from "../state";
import {
    addSheets, canPick, changeWounds, duplicateNpc, moveParticipant, openPopup, removeParticipant, selectParticipant, setAddSheetsOpen,
    setDisplayName, toggleGrouping, togglePicked, undoRemoval, ungroup,
} from "../actions";
import { openAddVariant } from "../../bestiary/actions";
import { woundsOf } from "../participants";
import { players, sheets } from "../../state";
import { sheetName } from "../../characters";
import { useClickOutside } from "../../components/useClickOutside";
import { useEscape } from "../../components/overlay";
import { useListSortable, type Drop } from "../../components/useListSortable";

// The order within a column is the turn order: only the column of a drop counts.
function dropCard({ item, to }: Drop): void {
    const side = to.closest<HTMLElement>("[data-column]")?.dataset.column;
    if (side === "party" || side === "enemies") moveParticipant(Number(item.dataset.participantId), side);
}

// A frame of a group is a list of its own, so its cards leave it one by one.
const sortableCards = {
    group: "encounter-cards",
    filter: "button, input, select, .encounter-card-menu",
    draggable: ".encounter-card",
    onDrop: dropCard,
};

export function ParticipantColumn({ side }: { side: Side }) {
    const mine = columnGroups.value.filter(g => g.side === side && g.members.length);
    const picking = grouping.value?.side === side;
    const body = useRef<HTMLDivElement>(null);
    useListSortable(body, sortableCards);
    return (
        <div class={picking ? "encounter-column participant-column picking" : "encounter-column participant-column"} data-column={side}>
            <div class="encounter-column-body" ref={body}>
                <p class="encounter-column-title">{side === "party" ? "Party" : "Enemies"}</p>
                {mine.map(g => g.members.length > 1
                    ? <Group key={g.id} group={g} />
                    : <Member key={g.members[0].participant.id} p={g.members[0]} />)}
            </div>
            <div class="encounter-column-footer">
                {side === "party" && <AddSheets />}
                <button type="button" class={picking ? "encounter-group button-colored" : "encounter-group"} onClick={() => toggleGrouping(side)}>
                    {picking ? "Join the picked" : "Group"}
                </button>
            </div>
        </div>
    );
}

function Group({ group }: { group: GroupView }) {
    const frame = useRef<HTMLDivElement>(null);
    useListSortable(frame, sortableCards);
    return (
        <div class={group.id === encounter.value?.currentGroupId ? "encounter-group-frame current" : "encounter-group-frame"}
            data-group-id={group.id} ref={frame}>
            <div class="encounter-group-header">
                <span>{group.label} · {group.value ?? "—"}</span>
                <button type="button" class="encounter-ungroup" title="Ungroup" aria-label="Ungroup" onClick={() => ungroup(group.id)}>⤫</button>
            </div>
            {group.members.map(m => <Member key={m.participant.id} p={m} />)}
        </div>
    );
}

function Member({ p }: { p: ParticipantView }) {
    return undoableRemovals.value.includes(p.participant.id) ? <DeletedCard p={p} /> : <Card p={p} />;
}

/** An NPC removed a moment ago, until its removal goes: not a card to drag or pick. */
function DeletedCard({ p }: { p: ParticipantView }) {
    return (
        <div class="encounter-card-deleted" data-participant-id={p.participant.id} data-sheet-id={p.participant.sheetId}>
            <span>Deleted <span class="encounter-muted">{p.name}</span></span>
            <button type="button" class="encounter-undo" onClick={() => undoRemoval(p.participant.id)}>Undo</button>
        </div>
    );
}

/** How far below zero the bar goes. */
const CRITICAL_WOUNDS = 10;

const share = (n: number, of: number) => `${of > 0 ? Math.max(0, Math.min(1, n / of)) * 100 : 0}%`;

/**
 * The wounds as a bar: on the left the damage below zero down to −10, dim
 * until the wounds go below zero; then the wounds of the maximum and, on the
 * right, the ablative wounds, each as wide as its count.
 */
function WoundsBar({ wounds }: { wounds: ReturnType<typeof woundsOf> }) {
    return (
        <span class={wounds.left < 0 ? "encounter-wounds-bar below-zero" : "encounter-wounds-bar"}>
            <span class="encounter-wounds-critical"><i style={{ width: share(-wounds.left, CRITICAL_WOUNDS) }} /></span>
            <span class="encounter-wounds-normal" style={{ flexGrow: Math.max(1, wounds.max) }}><i style={{ width: share(wounds.left, wounds.max) }} /></span>
            {wounds.ablative > 0 && (
                <span class="encounter-wounds-ablative" style={{ flexGrow: wounds.ablative }}><i style={{ width: share(wounds.ablativeLeft, wounds.ablative) }} /></span>
            )}
        </span>
    );
}

/** Two lines, as high as a creature of "Add monsters": the name with its buttons, the wounds. */
function Card({ p }: { p: ParticipantView }) {
    const { participant, sheet } = p;
    const pick = grouping.value;
    const picking = pick?.side === participant.side;
    const wounds = sheet ? woundsOf(sheet) : null;
    // A character leaves the party, and so every encounter of the room.
    const removeLabel = participant.npc ? "Remove from the encounter" : "Remove from the party";
    const classes = [
        "encounter-card",
        selected.value === participant.id && "selected",
        participant.groupId === encounter.value?.currentGroupId && "current",
    ].filter(Boolean).join(" ");
    const onClick = (e: MouseEvent) => {
        if ((e.target as Element).closest("button, input, .encounter-card-menu")) return;
        if (picking) togglePicked(participant.id);
        else selectParticipant(participant.id);
    };
    return (
        <div class={classes} data-participant-id={participant.id} data-sheet-id={participant.sheetId} onClick={onClick}>
            <div class="encounter-card-name">
                {picking && (
                    <input type="checkbox" class="custom encounter-pick" aria-label={`Pick ${p.name}`} disabled={!canPick(participant.id)}
                        checked={pick.picked.includes(participant.id)} onChange={() => togglePicked(participant.id)} />
                )}
                {/* One line of text, cut at its end: the name for players gives way first. */}
                <span class="encounter-card-names">
                    <span class="encounter-card-title">{p.name}</span>
                    {participant.displayName && (
                        <span class="encounter-card-shown-as" title={`For players: ${participant.displayName}`}>{participant.displayName}</span>
                    )}
                </span>
                <button type="button" class="encounter-icon encounter-open-sheet" title="Open the sheet" aria-label="Open the sheet"
                    disabled={!sheet} onClick={() => openPopup(participant.sheetId)}>↗</button>
                {participant.npc && <NpcMenu p={p} />}
                <button type="button" class="encounter-icon encounter-remove" title={removeLabel} aria-label={removeLabel}
                    onClick={() => removeParticipant(participant.id)}>×</button>
            </div>
            <div class="encounter-card-wounds">
                <button type="button" class="encounter-wounds-minus" title="Take a wound" aria-label="Take a wound"
                    disabled={!sheet} onClick={() => changeWounds(participant.id, -1)}>−</button>
                <span class="encounter-wounds-value">
                    {wounds ? `${wounds.left}/${wounds.max}` : "…"}
                    {wounds && wounds.ablative > 0 && (
                        <span class="encounter-ablative-left" title={`Ablative wounds: ${wounds.ablativeLeft} of ${wounds.ablative} left`}>
                            {`+${wounds.ablativeLeft}`}
                        </span>
                    )}
                </span>
                <button type="button" class="encounter-wounds-plus" title="Heal a wound" aria-label="Heal a wound"
                    disabled={!sheet} onClick={() => changeWounds(participant.id, 1)}>+</button>
                {wounds && <WoundsBar wounds={wounds} />}
            </div>
        </div>
    );
}

const MENU_MARGIN = 8;

/**
 * Places an open menu under its button, its right edge at the button's, or
 * over it without room below. It is fixed: the column scrolls and would clip it.
 */
function usePlacedMenu(menu: RefObject<HTMLElement>, open: boolean): void {
    useLayoutEffect(() => {
        const el = menu.current;
        if (!open || !el) return;
        const place = () => {
            const at = el.parentElement!.getBoundingClientRect();
            const below = at.bottom + 2;
            const top = below + el.offsetHeight <= innerHeight - MENU_MARGIN ? below : Math.max(MENU_MARGIN, at.top - 2 - el.offsetHeight);
            Object.assign(el.style, { top: `${top}px`, left: `${Math.max(MENU_MARGIN, at.right - el.offsetWidth)}px` });
        };
        place();
        addEventListener("scroll", place, true);
        addEventListener("resize", place);
        return () => {
            removeEventListener("scroll", place, true);
            removeEventListener("resize", place);
        };
    }, [open]);
}

/** The name the players see the NPC under, its copies and, copied from an own creature, a variant of it in the bestiary. */
function NpcMenu({ p }: { p: ParticipantView }) {
    const [open, setOpen] = useState(false);
    const [count, setCount] = useState(1);
    const [shownAs, setShownAs] = useState(p.participant.displayName ?? "");
    const box = useRef<HTMLSpanElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    useClickOutside(box, open, () => setOpen(false));
    usePlacedMenu(menu, open);
    // Copied from a creature of the gamemaster's own collection.
    const sourceName = p.participant.sourceCreatureId !== null ? p.participant.sourceCreatureName ?? "" : null;
    const toggle = () => {
        setShownAs(p.participant.displayName ?? "");
        setOpen(!open);
    };
    const saveShownAs = () => {
        setOpen(false);
        setDisplayName(p.participant.id, shownAs);
    };
    return (
        <span class="encounter-card-menu" ref={box}>
            <button type="button" class="encounter-icon encounter-npc-menu-btn" title="NPC menu" aria-label="NPC menu" aria-expanded={open}
                onClick={toggle}>⋯</button>
            {open && (
                <div class="encounter-menu encounter-npc-menu" role="menu" ref={menu}>
                    <label class="encounter-npc-menu-field">
                        <span class="encounter-muted">Name for players</span>
                        <span class="layout-row">
                            <input class="encounter-display-name" value={shownAs} maxLength={100} placeholder={p.name}
                                onInput={e => setShownAs(e.currentTarget.value)}
                                onKeyDown={e => e.key === "Enter" && saveShownAs()} />
                            <button type="button" class="encounter-display-name-save" onClick={saveShownAs}>Save</button>
                        </span>
                    </label>
                    <label class="encounter-npc-menu-field">
                        <span class="encounter-muted">Copies</span>
                        <span class="layout-row">
                            <input type="number" min={1} max={20} value={count} class="encounter-duplicate-count"
                                onInput={e => setCount(Math.max(1, Math.min(20, Number(e.currentTarget.value) || 1)))} />
                            <button type="button" class="encounter-duplicate" onClick={() => {
                                setOpen(false);
                                duplicateNpc(p.participant.id, count);
                            }}>Duplicate</button>
                        </span>
                    </label>
                    {sourceName !== null && (
                        <button type="button" role="menuitem" class="encounter-add-variant" title={`A new creature next to "${sourceName}"`} onClick={() => {
                            setOpen(false);
                            openAddVariant(p.participant.sheetId, p.name, sourceName);
                        }}>Add variant to bestiary…</button>
                    )}
                </div>
            )}
        </span>
    );
}

/** "Add sheets" and its popup: the sheets of the room to add to its party, hidden ones too, as the gamemaster sees them all. */
function AddSheets() {
    const open = addSheetsOpen.value;
    const box = useRef<HTMLDivElement>(null);
    useClickOutside(box, open, () => setAddSheetsOpen(false));
    return (
        <div class="encounter-add-sheets-box" ref={box}>
            <button type="button" class="button-colored encounter-add-sheets" aria-expanded={open} onClick={() => setAddSheetsOpen(!open)}>
                Add sheets
            </button>
            {open && <AddSheetsPopup />}
        </div>
    );
}

function AddSheetsPopup() {
    const [picked, setPicked] = useState<number[]>([]);
    useEscape(() => setAddSheetsOpen(false));
    const added = new Set(encounter.value?.participants.map(p => p.sheetId));
    const ownerName = (id: number) => players.value.find(p => p.id === id)?.name ?? "";
    const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter(p => p !== id) : [...picked, id]);
    return (
        <div class="encounter-add-sheets-popup layout-column" role="dialog" aria-label="Add sheets">
            <div class="encounter-sheet-list">
                {sheets.value.map(s => (
                    <label key={s.id} class={added.has(s.id) ? "encounter-sheet-option encounter-muted" : "encounter-sheet-option"}>
                        <input type="checkbox" class="custom" data-sheet-id={s.id} disabled={added.has(s.id)}
                            checked={added.has(s.id) || picked.includes(s.id)} onChange={() => toggle(s.id)} />
                        <span class="encounter-sheet-option-text">
                            <span class="encounter-sheet-option-name">{sheetName(s)}</span>
                            <span class="encounter-muted encounter-sheet-option-owner">{ownerName(s.ownerId)}</span>
                        </span>
                    </label>
                ))}
                {!sheets.value.length && <p class="encounter-muted">The room has no sheets.</p>}
            </div>
            <button type="button" class="button-colored encounter-add-picked" disabled={!picked.length} onClick={() => addSheets(picked)}>Add</button>
        </div>
    );
}
