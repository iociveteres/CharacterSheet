// The parts of the room Preact renders, each into its own mount point of
// view_room.html. The mount points are x-ignore, so Alpine leaves them alone.
import { render } from "preact";
import { Toasts } from "./components/Toasts";
import { Modals } from "./components/Modals";

export function mountIslands(): void {
    render(<Toasts />, document.getElementById("toasts")!);
    render(<Modals />, document.getElementById("modals")!);
}
