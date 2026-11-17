// The heading of the melee attacks with the stance of the sheet
// (weapons/stanceRules.ts): six toggles under it, the current one framed in the accent; one the
// sheet has no weapon for is dimmed, the reason on hover, but still taken.
// They start hidden: the heading says the stance, as "Aggressive ▾", which
// shows them; ▴ right of the heading hides them again. The sheet keeps which
// (settings.meleeAttacks.stances).
import { useComputed } from "@preact/signals";
import { t } from "../../i18n";
import { useSheet } from "../components/context";
import { STANCES, stanceOf, stanceTitle, stanceUnavailable, storedStance, type Stance } from "./stanceRules";
import { valueAt } from "../core/sync";
import { BlockHeading } from "../rolls/BlockSettings";

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
        return canEdit ? <button type="button" class="stance-corner-button" title={t("sheet.weapons.stances.hide")} onClick={() => actions.change(SHOWN, false)}>▴</button> : null;
    }
    return (
        <button type="button" class={standard ? "stance-corner-button" : "stance-corner-button current"} disabled={!canEdit}
            title={standard ? t("sheet.weapons.stances.show") : stanceTitle(stance, null)} onClick={() => actions.change(SHOWN, true)}>
            {`${standard ? t("sheet.weapons.stance") : stance.name} ▾`}
        </button>
    );
}

/** The heading of the melee attacks with its ⚙ and the stances. */
export function MeleeAttacksHeading() {
    const { state } = useSheet();
    const shown = valueAt(state, SHOWN) === true;
    const current = stanceOf(state).key;
    return (
        <BlockHeading level="h3" heading={t("sheet.terms.block.meleeAttacks")} block="meleeAttacks" rolls={t("sheet.kinds.attacks")}
            title={t("sheet.weapons.meleeAttacksSettings")}
            corner={<StanceCorner shown={shown} />}>
            {shown && (
                <div class="stance-grid" data-id="stances">
                    {STANCES.map(s => <StanceButton key={s.key} stance={s} current={s.key === current} />)}
                </div>
            )}
        </BlockHeading>
    );
}
