// What a sheet sets up that its DOM does not take away with it: effects on
// signals, the Preact root and the autocomplete. Each sheet has its scope;
// main.ts releases it before it removes or replaces the sheet.
import { computed, effect, type ReadonlySignal } from "@preact/signals-core";

type Disposer = () => void;

export class SheetScope {
    private disposers: Disposer[] = [];

    /** Runs `dispose` when the sheet is removed. */
    onTeardown(dispose: Disposer): void {
        this.disposers.push(dispose);
    }

    /** An effect that lives as long as the sheet. */
    effect(fn: () => void | (() => void)): Disposer {
        const dispose = effect(fn);
        this.onTeardown(dispose);
        return dispose;
    }

    /** Releases everything the sheet registered, newest first. */
    teardown(): void {
        while (this.disposers.length) {
            const dispose = this.disposers.pop()!;
            try {
                dispose();
            } catch (err) {
                console.error("Sheet teardown failed", err);
            }
        }
    }

    /** How many disposers are waiting, for tests. */
    get pending(): number {
        return this.disposers.length;
    }
}

// The scope of the one sheet the page shows, until sheets live side by side
// (_prd/gm_mode/sheet-instance-prd.md).
const defaultScope = new SheetScope();

/** Runs `dispose` when the current sheet is removed. */
export const onSheetTeardown = (dispose: Disposer): void => defaultScope.onTeardown(dispose);

/** An effect that lives as long as the current sheet. */
export const sheetEffect = (fn: () => void | (() => void)): Disposer => defaultScope.effect(fn);

/** A computed of `fn` that all its readers share while the current sheet is open; the next sheet builds it again. */
export function sheetComputed<T>(fn: () => T): () => T {
    let signal: ReadonlySignal<T> | null = null;
    return () => {
        if (!signal) {
            signal = computed(fn);
            onSheetTeardown(() => { signal = null; });
        }
        return signal.value;
    };
}

/** Releases everything the current sheet registered, newest first. */
export const teardownSheet = (): void => defaultScope.teardown();
