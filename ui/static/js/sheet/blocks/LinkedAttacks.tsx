// The Attacks row of a weapon in the gear: a chip per attack linked to the
// item (state/itemLink.ts), which shows that attack on the Combat tab, and
// ＋ Attack, which makes one from the rulebook entry of the item's name. A
// name both collections have, as a spear thrown or held, offers either.
import { useState } from "preact/hooks";
import { nanoid } from "nanoid";
import { useComputed } from "@preact/signals";
import { createAtEnd } from "../components/columns";
import { useSheet, type SheetEnv } from "../components/context";
import { idsInOrder } from "../state/gridOrder";
import { MELEE_ATTACKS, RANGED_ATTACKS, itemName, linkedAttacks, type AttackBlock, type LinkedAttack } from "../state/itemLink";
import { COMBAT_TAB, NAVIGATION_TABS, type SheetUiState } from "../state/ui";
import { newMeleeAttack, newMeleeAttackBase, newRangedAttack } from "./Attacks";
import { findEntry } from "./ItemLink";

const BLOCKS = {
    [MELEE_ATTACKS]: { collection: "melee", idPrefix: "melee-attack", heading: "Melee Attacks", mark: "⚔" },
    [RANGED_ATTACKS]: { collection: "ranged", idPrefix: "ranged-attack", heading: "Ranged Attacks", mark: "➶" },
} as const;

/** Opens the Combat tab and scrolls to the attack at `path`, flashing it, once it is rendered. */
function showAttack(ui: SheetUiState, path: string, tries = 10): void {
    ui.selectedTabSignal(NAVIGATION_TABS).value = COMBAT_TAB;
    requestAnimationFrame(() => {
        const el = ui.elementOf(path);
        if (!el) {
            if (tries > 0) showAttack(ui, path, tries - 1);
            return;
        }
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.remove("link-flash");
        // Restarts the animation of a second click.
        void (el as HTMLElement).offsetWidth;
        el.classList.add("link-flash");
    });
}

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
            <button type="button" class="mod-chip-name" title={`${heading} → ${attack.name || "—"}`} onClick={() => showAttack(ui, attack.path)}>
                {`${mark} ${attack.name || "—"}`}
            </button>
        </span>
    );
}

type Matches = { melee: string; ranged: string };

/** The Attacks row of the weapon `itemId` of the gear; nothing for a viewer of a weapon without attacks. */
export function LinkedAttacks({ itemId }: { itemId: string }) {
    const env = useSheet();
    const { state, canEdit, autocomplete, kindName } = env;
    const attacks = useComputed(() => linkedAttacks(state, itemId)).value;
    const [busy, setBusy] = useState(false);
    const [both, setBoth] = useState<Matches | null>(null);
    if (!canEdit && attacks.length === 0) return null;

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

    return (
        <div class="item-mods attacks-row" data-id="attacks">
            <div class="mods-row">
                <span class="mods-label">Attacks:</span>
                {attacks.map(a => <AttackChip key={a.path} attack={a} />)}
                {canEdit && !both && (
                    <button type="button" class="add-mod add-attack" data-id="addAttack" disabled={busy}
                        title={`Create an attack of ${itemName(state.gear.list.items[itemId])} from the rulebook, linked to it`}
                        onClick={() => void add()}>＋ Attack</button>
                )}
                {both && (
                    <span class="attack-choice" data-id="attackChoice" title="The rulebook has the weapon held and thrown">
                        <button type="button" class="add-mod" onClick={() => choose([MELEE_ATTACKS])}>Melee</button>
                        <button type="button" class="add-mod" onClick={() => choose([RANGED_ATTACKS])}>Ranged</button>
                        <button type="button" class="add-mod" onClick={() => choose([MELEE_ATTACKS, RANGED_ATTACKS])}>Both</button>
                        <button type="button" class="add-mod" title="Cancel" onClick={() => setBoth(null)}>✖</button>
                    </span>
                )}
            </div>
        </div>
    );
}
