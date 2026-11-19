// The full sheet over the page: of a participant over the encounter window,
// of a creature over the bestiary. Esc and a click on the overlay close it.
import { useRef } from "preact/hooks";
import { t } from "../../i18n";
import { type SheetInstance, useSheetView, renderSheetView } from "../../sheet/api";
import { closeOnOverlay, useEscape } from "./overlay";

export function SheetPopup({ sheet, close }: { sheet: SheetInstance | null; close: () => void }) {
    const box = useRef<HTMLDivElement>(null);
    useEscape(close);
    useSheetView(box, sheet, (s, target, css) => renderSheetView(s, target, css, "popup-sheet"));

    return (
        <div class="overlay open" onClick={closeOnOverlay(close)}>
            <div class="modal sheet-popup" role="dialog" aria-modal="true" aria-label={t("room.modals.sheet")}>
                <button type="button" class="close sheet-popup-close" aria-label={t("common.close")} onClick={close}>×</button>
                <div class="sheet-popup-body" ref={box} />
            </div>
        </div>
    );
}
