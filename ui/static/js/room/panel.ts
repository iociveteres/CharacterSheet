// Whether the right panel is shown, which the player keeps in localStorage.

const PANEL_KEY = "rightPanelVisible";

/** Shown unless the player hid it. */
export function readPanelVisible(): boolean {
    try {
        return localStorage.getItem(PANEL_KEY) !== "false";
    } catch {
        return true;
    }
}

export function savePanelVisible(visible: boolean): void {
    try {
        localStorage.setItem(PANEL_KEY, String(visible));
    } catch {
        // storage can be unavailable
    }
}
