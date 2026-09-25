// Init sequence for the Black Crusade sheet layout
// (ui/html/kinds/black_crusade.html): every block is a Preact block mounted
// at its mount point.
import { mountBlocks } from "../blocks/index";

export function init(ctx) {
    mountBlocks(ctx.root);
}
