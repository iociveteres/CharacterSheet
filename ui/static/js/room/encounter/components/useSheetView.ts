import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import type { SheetInstance } from "../../../sheet/instance";
import { loadedStylesheet, sheetStylesheet } from "../../../sheet/view";

type RenderView = (sheet: SheetInstance, box: HTMLElement, css: CSSStyleSheet) => () => void;

/**
 * Renders a view of `sheet` into the element of `box` once the sheet's styles
 * are loaded, and takes it away on unmount. A sheet read again is a new
 * instance: the view moves to it.
 */
export function useSheetView(box: RefObject<HTMLElement>, sheet: SheetInstance | null, render: RenderView): void {
    useEffect(() => {
        const target = box.current;
        if (!sheet || !target) return;
        let unmount: (() => void) | null = null;
        let gone = false;
        const show = (css: CSSStyleSheet) => {
            if (!gone) unmount = render(sheet, target, css);
        };
        const css = loadedStylesheet();
        if (css) show(css);
        else sheetStylesheet().then(show).catch(err => console.error(err));
        return () => {
            gone = true;
            unmount?.();
            target.replaceChildren();
        };
    }, [sheet]);
}
