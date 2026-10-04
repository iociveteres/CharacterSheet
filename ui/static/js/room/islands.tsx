// The parts of the room Preact renders, each into its own mount point of
// view_room.html. The rest of the page is the template's; the sheet renders
// itself into #character-sheet-container (sheet/main.ts).
import { render } from "preact";
import { effect } from "@preact/signals";
import { rightPanelVisible } from "./state";
import { Toasts } from "./components/Toasts";
import { Modals } from "./components/Modals";
import { Chat } from "./components/Chat";
import { RoomControls } from "./components/RoomControls";
import { Characters } from "./components/Characters";
import { Players } from "./components/Players";
import { EncounterWindow } from "./encounter/components/EncounterWindow";
import { InitiativeWindow } from "./encounter/components/InitiativeWindow";
import { encounterList, gmMode } from "./encounter/state";

export function mountIslands(): void {
    render(<Toasts />, document.getElementById("toasts")!);
    render(<Modals />, document.getElementById("modals")!);
    render(<Chat />, document.getElementById("chat")!);
    render(<RoomControls />, document.getElementById("room-controls")!);
    render(<Characters />, document.getElementById("characters")!);
    render(<Players />, document.getElementById("players")!);
    render(<EncounterWindow />, document.getElementById("encounter")!);
    render(<InitiativeWindow />, document.getElementById("initiative-window")!);

    // room.css hides the panel and widens the sheet by these classes.
    const room = document.getElementById("room")!;
    const panel = document.getElementById("right-panel")!;
    effect(() => {
        room.classList.toggle("panel-hidden", !rightPanelVisible.value);
        panel.classList.toggle("hidden-panel", !rightPanelVisible.value);
    });
    // The encounter window takes the place of the sheet, which stays open behind it.
    effect(() => {
        room.classList.toggle("gm-mode", gmMode.value && encounterList.value !== null);
    });
}
