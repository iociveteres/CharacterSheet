// The Attacks row of a weapon in the gear: a chip per attack linked to the
// item (state/itemLink.ts), which shows that attack on the Combat tab, and
// ＋ attack, which makes one from the rulebook entry of the item's name. A
// name both collections have, as a spear thrown or held, offers either.
// The attack's name marks the link back (AttackLinkMark in ItemLink.tsx).
import { useState } from "preact/hooks";
import { nanoid } from "nanoid";
import { useComputed } from "@preact/signals";
import { createAtEnd } from "../components/columns";
import { useSheet, type SheetEnv } from "../components/context";
import { idsInOrder } from "../state/gridOrder";
import { MELEE_ATTACKS, RANGED_ATTACKS, itemName, linkedAttacks, type AttackBlock, type LinkedAttack } from "../state/itemLink";
import { COMBAT_TAB, showItem } from "../state/ui";
import { newMeleeAttack, newMeleeAttackBase, newRangedAttack } from "./Attacks";
import { findEntry } from "./ItemLink";

const BLOCKS = {
    [MELEE_ATTACKS]: { collection: "melee", idPrefix: "melee-attack", heading: "Melee Attacks", mark: "⚔" },
    [RANGED_ATTACKS]: { collection: "ranged", idPrefix: "ranged-attack", heading: "Ranged Attacks", mark: "➶" },
} as const;

/**
 * Makes an attack of `block` linked to the item `itemId`: the rulebook entry
 * `entryName` over a new attack, or without one a new melee attack of the
 * item's name with the Strength bonus.
 */
function createAttack({ state, actions, rollDefaults }: SheetEnv, block: AttackBlock, itemId: string, name: string, entryName: string | null): void {
    const { collection, idPrefix } = BLOCKS[block];
    const attackId = `${idPrefix}-${nanoid()}`;
    const fresh = block === RANGED_ATTACKS ? newRangedAttack(state, rollDefaults)
        : entryName ? newMeleeAttackBase(state, rollDefaults) : newMeleeAttack(state, rollDefaults);
    const init = { ...fresh, name, item: itemId };
    createAtEnd(actions, block, [idsInOrder(state, block)], 0, attackId, init);
    if (entryName) actions.autocompleteApply(`${block}.${attackId}`, collection, entryName, init);
}

function AttackChip({ attack }: { attack: LinkedAttack }) {
    const { ui } = useSheet();
    const { heading, mark } = BLOCKS[attack.block];
    return (
        <span class="mod-chip attack-chip">
            <button type="button" class="mod-chip-name" title={`${heading} → ${attack.name || "—"}`} onClick={() => showItem(ui, COMBAT_TAB, attack.path)}>
                {`${mark} ${attack.name || "—"}`}
            </button>
        </span>
    );
}

type Matches = { melee: string; ranged: string };

/** How the item makes its attacks: the item holds it, as the ＋ attack of a weapon without any is outside its row (Gear.tsx). */
export interface AttackAdder {
    busy: boolean;
    /** The rulebook entries of a weapon held and thrown, while the player picks. */
    both: Matches | null;
    add: () => void;
    choose: (blocks: AttackBlock[]) => void;
    cancel: () => void;
}

export function useAttackAdder(itemId: string): AttackAdder {
    const env = useSheet();
    const { state, autocomplete, kindName } = env;
    const [busy, setBusy] = useState(false);
    const [both, setBoth] = useState<Matches | null>(null);

    const name = () => String(state.gear.list.items[itemId]?.name?.peek() ?? "").trim();
    const add = async () => {
        const typed = name();
        setBusy(true);
        const [melee, ranged] = autocomplete
            ? await Promise.all(["melee", "ranged"].map(c => findEntry(autocomplete, kindName, c, typed)))
            : [null, null];
        setBusy(false);
        if (melee && ranged) setBoth({ melee: melee.name, ranged: ranged.name });
        else if (ranged) createAttack(env, RANGED_ATTACKS, itemId, typed, ranged.name);
        else createAttack(env, MELEE_ATTACKS, itemId, typed, melee?.name ?? null);
    };
    const choose = (blocks: AttackBlock[]) => {
        for (const block of blocks) createAttack(env, block, itemId, name(), block === MELEE_ATTACKS ? both!.melee : both!.ranged);
        setBoth(null);
    };
    return { busy, both, add: () => void add(), choose, cancel: () => setBoth(null) };
}

/** ＋ Attack of the weapon `itemId`, in its row or in the item's add line. */
export function AddAttackButton({ itemId, adder, class: cls }: { itemId: string; adder: AttackAdder; class: string }) {
    const { state } = useSheet();
    return (
        <button type="button" class={cls} data-id="addAttack" disabled={adder.busy}
            title={`Create an attack of ${itemName(state.gear.list.items[itemId])} from the rulebook, linked to it`}
            onClick={adder.add}>＋ attack</button>
    );
}

/** The Attacks row of the weapon `itemId` of the gear: shown while it has attacks or the player picks melee or ranged. */
export function LinkedAttacks({ itemId, adder }: { itemId: string; adder: AttackAdder }) {
    const { state, canEdit } = useSheet();
    const attacks = useComputed(() => linkedAttacks(state, itemId)).value;
    const { both, choose, cancel } = adder;
    if (attacks.length === 0 && !(canEdit && both)) return null;

    return (
        <div class="item-mods attacks-row" data-id="attacks">
            <div class="mods-row">
                <span class="mods-label">Attacks:</span>
                {attacks.map(a => <AttackChip key={a.path} attack={a} />)}
                {canEdit && !both && <AddAttackButton itemId={itemId} adder={adder} class="add-mod add-attack" />}
                {canEdit && both && (
                    <span class="attack-choice" data-id="attackChoice" title="The rulebook has the weapon held and thrown">
                        <button type="button" class="add-mod" onClick={() => choose([MELEE_ATTACKS])}>Melee</button>
                        <button type="button" class="add-mod" onClick={() => choose([RANGED_ATTACKS])}>Ranged</button>
                        <button type="button" class="add-mod" onClick={() => choose([MELEE_ATTACKS, RANGED_ATTACKS])}>Both</button>
                        <button type="button" class="add-mod" title="Cancel" onClick={cancel}>✖</button>
                    </span>
                )}
            </div>
        </div>
    );
}
