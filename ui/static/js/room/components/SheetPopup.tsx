// The full sheet over the page: of a participant over the encounter window,
// of a creature over the bestiary. Esc and a click on the overlay close it.
import { useRef } from "preact/hooks";
import type { SheetInstance } from "../../sheet/instance";
import { useSheetView } from "../../sheet/useSheetView";
import { renderSheetView } from "../../sheet/view";
import { closeOnOverlay, useEscape } from "./overlay";

export function SheetPopup({ sheet, close }: { sheet: SheetInstance | null; close: () => void }) {
    const box = useRef<HTMLDivElement>(null);
    useEscape(close);
    useSheetView(box, sheet, (s, target, css) => renderSheetView(s, target, css, "popup-sheet"));

    return (
        <div class="overlay open" onClick={closeOnOverlay(close)}>
            <div class="modal sheet-popup" role="dialog" aria-modal="true" aria-label="Sheet">
                <button type="button" class="close sheet-popup-close" aria-label="Close" onClick={close}>×</button>
                <div class="sheet-popup-body" ref={box} />
            </div>
        </div>
    );
}
