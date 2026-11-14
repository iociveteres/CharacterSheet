import { afterEach, expect, it } from "vitest";
import { computed, effect } from "@preact/signals-core";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { attachComputeds } from "../kinds/computed";
import { updateSignalAtPath } from "../core/sync";
import { castCap } from "./psychic";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const N = 6;
const power = (id: string) => `psykana.tabs.items.t1.powers.items.${id}`;

afterEach(teardownSheet);

it("counts the PR of a power again when a sustained mark changes, not when a power is renamed", () => {
    const ids = Array.from({ length: N }, (_, i) => `p${i}`);
    loadState({
        characteristics: { I: { value: "45" } },
        settings: { psykana: { sustained: true, cycle: true } },
        psykana: {
            basePR: 8,
            tabs: {
                items: {
                    t1: {
                        name: "Tab",
                        powers: {
                            items: Object.fromEntries(ids.map(id => [id, { name: id, subtypes: "Cycle (3)", sustained: "Free", sustain: { copies: 1, pr: 2 } }])),
                            layouts: Object.fromEntries(ids.map((id, i) => [id, pos(0, i)])),
                        },
                    },
                },
                layouts: { t1: pos(0, 0) },
            },
        },
    });
    const state = testState();
    attachComputeds(state);
    // Each power's damage field reads its own cap; one of them stands for all.
    let runs = 0;
    const cap = computed(() => {
        runs++;
        return castCap(state, power("p0"));
    });
    const dispose = effect(() => void cap.value);
    expect(cap.value).toBe(8 - (N - 1));

    runs = 0;
    updateSignalAtPath(state, `${power("p3")}.name`, "Shield");
    updateSignalAtPath(state, `${power("p3")}.sustain.pr`, 4);
    expect(runs).toBe(0);

    // ½I.b▲ = 2 of the others are free by Cycle.
    updateSignalAtPath(state, `${power("p1")}.sustain.free`, true);
    updateSignalAtPath(state, `${power("p2")}.sustain.free`, true);
    expect(cap.value).toBe(8 - (N - 3));
    updateSignalAtPath(state, `${power("p3")}.sustain.copies`, 0);
    expect(cap.value).toBe(8 - (N - 4));
    expect(runs).toBe(3);
    dispose();
});
