import { useEffect, useState } from "preact/hooks";

/**
 * Whether the tab panel at `panelRef` has been drawn at its width while
 * `open`: its cards skip their rendering off screen only then (sheet.css
 * .panel.drawn). By then each card has remembered its size, so skipping it
 * moves nothing; a skipped card keeps that size, so a new width draws them
 * all again. Every panel answers for its own cards: those of a closed tab
 * inside a drawn one have not been drawn yet.
 */
export function useDrawn(panelRef: { current: HTMLElement | null }, open: boolean): boolean {
    const [drawn, setDrawn] = useState(false);
    useEffect(() => {
        if (!open || drawn) return;
        let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setDrawn(true)); });
        return () => cancelAnimationFrame(frame);
    }, [open, drawn]);
    useEffect(() => {
        const panel = panelRef.current;
        if (!panel || typeof ResizeObserver === "undefined") return;
        let width = panel.clientWidth;
        let timer = 0;
        // While the width changes the cards off screen stay skipped at the sizes they had, and scroll
        // anchoring keeps the cards on screen in place; drawing them all at every step of a window
        // drag took 400 ms a step on Stress XL at CPU 4x. Once the width has been still, the panel is
        // drawn again, so that every card remembers its size at the new width.
        const observer = new ResizeObserver(() => {
            if (panel.clientWidth === width) return;
            width = panel.clientWidth;
            clearTimeout(timer);
            timer = window.setTimeout(() => setDrawn(false), 150);
        });
        observer.observe(panel);
        return () => {
            observer.disconnect();
            clearTimeout(timer);
        };
    }, []);
    return drawn;
}
