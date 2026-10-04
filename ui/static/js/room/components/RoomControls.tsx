// The buttons at the left edge of the right panel: GM mode for the
// gamemaster, the initiative window, the dice roller and the panel's toggle. They stay
// on screen when the panel is hidden.
import { rightPanelVisible } from "../state";
import { toggleRightPanel } from "../actions";
import { encounterList, gmMode, initiativeWindowOpen } from "../encounter/state";
import { toggleGmMode, toggleInitiativeWindow } from "../encounter/actions";
import { DiceRoller } from "./DiceRoller";

export function RoomControls() {
    const visible = rightPanelVisible.value;
    return (
        <>
            <div class="encounter-controls">
                {/* The server gives the encounters to the gamemaster only. */}
                {encounterList.value && (
                    <button type="button" class={gmMode.value ? "gm-mode-btn active" : "gm-mode-btn"} onClick={toggleGmMode}
                        aria-pressed={gmMode.value} title={gmMode.value ? "Back to the sheet" : "GM mode: the encounter in place of the sheet"}>
                        GM
                    </button>
                )}
                <button type="button" class={initiativeWindowOpen.value ? "initiative-btn active" : "initiative-btn"}
                    onClick={toggleInitiativeWindow} aria-pressed={initiativeWindowOpen.value} title="Initiative">
                    ⚔
                </button>
            </div>
            <div class="dice-roller-wrapper" id="dice-roller">
                <DiceRoller />
            </div>
            <button onClick={toggleRightPanel} class="toggle-panel-btn" type="button"
                title={visible ? "Hide sidebar" : "Show sidebar"}>
                <span>{visible ? "→" : "←"}</span>
            </button>
        </>
    );
}
