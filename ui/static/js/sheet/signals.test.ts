import { describe, expect, it } from "vitest";
import * as signals from "@preact/signals";
import * as core from "@preact/signals-core";

// @preact/signals re-exports signals-core. If a second copy of signals-core got
// installed, components would subscribe to a different graph than network.js writes.
describe("signals", () => {
    it("come from a single copy of signals-core", () => {
        expect(signals.signal).toBe(core.signal);
        expect(signals.Signal).toBe(core.Signal);
        expect(signals.signal(0)).toBeInstanceOf(core.Signal);
    });
});
