// What a sheet sets up that its DOM does not take away with it: effects on
// signals and Preact roots. room.js fires charactersheet_removing before it
// replaces the sheet, and all of it is released then.
import { effect } from "@preact/signals-core";

type Disposer = () => void;

const disposers: Disposer[] = [];

/** Runs `dispose` when the current sheet is removed. */
export function onSheetTeardown(dispose: Disposer): void {
    disposers.push(dispose);
}

/** An effect that lives as long as the current sheet. */
export function sheetEffect(fn: () => void | (() => void)): Disposer {
    const dispose = effect(fn);
    onSheetTeardown(dispose);
    return dispose;
}

/** Releases everything the current sheet registered, newest first. */
export function teardownSheet(): void {
    while (disposers.length) {
        const dispose = disposers.pop()!;
        try {
            dispose();
        } catch (err) {
            console.error("Sheet teardown failed", err);
        }
    }
}

/** How many disposers are waiting, for tests and the leftover check. */
export function pendingTeardowns(): number {
    return disposers.length;
}

document.addEventListener("charactersheet_removing", teardownSheet);
