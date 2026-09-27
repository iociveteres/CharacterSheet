// The parts of the room Preact renders, each into its own mount point of
// view_room.html. The mount points are x-ignore, so Alpine leaves them alone.
import { render } from "preact";
import { Toasts } from "./components/Toasts";
import { Modals } from "./components/Modals";
import { Chat } from "./components/Chat";
import { DiceRoller } from "./components/DiceRoller";

export function mountIslands(): void {
    render(<Toasts />, document.getElementById("toasts")!);
    render(<Modals />, document.getElementById("modals")!);
    render(<Chat />, document.getElementById("chat")!);
    render(<DiceRoller />, document.getElementById("dice-roller")!);
}
