import { afterEach, describe, expect, it } from "vitest";
import type { Signal } from "@preact/signals-core";
import { loadState } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "./computed.js";
import { characterState } from "./state";
import { resolvePath } from "./sync";

const cost = (id: string) => (resolvePath(`experience.experienceLog.items.${id}.computedCost`) as Signal<unknown>).value;

afterEach(() => teardownSheet());

describe("the cost of an advancement", () => {
    it("comes from the table of its type, level and matching aptitudes", () => {
        loadState({
            experience: {
                useAptitudes: true,
                aptitudes: "WS, Off",
                experienceLog: {
                    items: {
                        noMatch: { type: "characteristic", level: 3, aptitudes: "Fel" },
                        twoMatches: { type: "talent", level: 2, aptitudes: "WS, Off" },
                        oneMatch: { type: "skill", level: 4, aptitudes: "Off, Fel" },
                        // Left from a characteristic, above the last talent level: the last one counts.
                        tooHigh: { type: "talent", level: 5, aptitudes: "WS" },
                        // Without a level: the first one. Every character has General.
                        noLevel: { type: "skill", aptitudes: "Gen" },
                        other: { type: "other", experienceCost: 50 },
                    },
                    layouts: {},
                },
            },
        });
        attachComputeds(characterState);

        expect(cost("noMatch")).toBe(1000);
        expect(cost("twoMatches")).toBe(300);
        expect(cost("oneMatch")).toBe(750);
        expect(cost("tooHigh")).toBe(750);
        expect(cost("noLevel")).toBe(200);
        expect(cost("other")).toBe(50);
    });
});
