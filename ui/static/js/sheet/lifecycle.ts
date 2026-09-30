// What a sheet sets up that its DOM does not take away with it: effects on
// signals, the Preact root, the autocomplete, the rolls on their way. Each
// sheet has its scope (instance.ts); dispose() of the sheet releases it.
import { effect } from "@preact/signals-core";

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
