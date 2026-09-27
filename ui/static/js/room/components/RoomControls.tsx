// The buttons at the left edge of the right panel: the dice roller and the
// panel's toggle. They stay on screen when the panel is hidden.
import { rightPanelVisible } from "../state";
import { toggleRightPanel } from "../actions";
import { DiceRoller } from "./DiceRoller";

export function RoomControls() {
    const visible = rightPanelVisible.value;
    return (
        <>
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
