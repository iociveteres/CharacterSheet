// The heading of the melee attacks with the stance of the sheet
// (state/stances.ts): six toggles under it, the current one filled; one the
// sheet has no weapon for is dimmed, the reason on hover, but still taken.
// ▴ right of the heading hides them, which the sheet keeps
// (settings.meleeAttacks.stances); hidden, the heading says the stance, as
// "Aggressive ▾", which shows them again.
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { STANCES, stanceOf, stanceTitle, stanceUnavailable, storedStance, type Stance } from "../state/stances";
import { valueAt } from "../state/sync";
import { BlockHeading } from "./BlockSettings";

const SHOWN = "settings.meleeAttacks.stances";

function StanceButton({ stance, current }: { stance: Stance; current: boolean }) {
    const { state, actions, canEdit } = useSheet();
    const unavailable = useComputed(() => stanceUnavailable(state, stance.key)).value;
    const classes = ["stance-button", current && "on", unavailable && "unavailable"].filter(Boolean).join(" ");
    return (
        <button type="button" class={classes} data-stance={stance.key} disabled={!canEdit} title={stanceTitle(stance, unavailable)}
            onClick={() => actions.change("meleeAttacks.stance", storedStance(stance.key))}>{stance.name}</button>
    );
}

/** ▴ while the stances show; the stance and ▾ while they are hidden, dimmed in Standard. */
function StanceCorner({ shown }: { shown: boolean }) {
    const { state, actions, canEdit } = useSheet();
    const stance = stanceOf(state);
    const standard = stance.key === "standard";
    if (shown) {
        return canEdit ? <button type="button" class="stance-corner-button" title="Hide the stances" onClick={() => actions.change(SHOWN, false)}>▴</button> : null;
    }
    return (
        <button type="button" class={standard ? "stance-corner-button" : "stance-corner-button current"} disabled={!canEdit}
            title={standard ? "Show the stances" : stanceTitle(stance, null)} onClick={() => actions.change(SHOWN, true)}>
            {`${standard ? "Stance" : stance.name} ▾`}
        </button>
    );
}

/** The heading of the melee attacks with its ⚙ and the stances. */
export function MeleeAttacksHeading() {
    const { state } = useSheet();
    // A missing flag is on, as the settings of psykana.
    const shown = valueAt(state, SHOWN) !== false;
    const current = stanceOf(state).key;
    return (
        <BlockHeading level="h3" heading="Melee Attacks" block="meleeAttacks" rolls="Attacks" title="Test options of the melee attacks"
            corner={<StanceCorner shown={shown} />}>
            {shown && (
                <div class="stance-grid" data-id="stances">
                    {STANCES.map(s => <StanceButton key={s.key} stance={s} current={s.key === current} />)}
                </div>
            )}
        </BlockHeading>
    );
}
