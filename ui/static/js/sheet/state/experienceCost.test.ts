import { afterEach, describe, expect, it } from "vitest";
import type { Signal } from "@preact/signals-core";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { resolvePath } from "./sync";

const cost = (id: string) => (resolvePath(testState(), `experience.experienceLog.items.${id}.computedCost`) as Signal<unknown>).value;

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
        attachComputeds(testState());

        expect(cost("noMatch")).toBe(1000);
        expect(cost("twoMatches")).toBe(300);
        expect(cost("oneMatch")).toBe(750);
        expect(cost("tooHigh")).toBe(750);
        expect(cost("noLevel")).toBe(200);
        expect(cost("other")).toBe(50);
    });
});

describe("the cost of spells and Power Rating in Pathfinder Crusade", () => {
    const load = (spellcasting: object) => {
        loadState({
            spellcasting,
            experience: {
                experienceLog: {
                    items: {
                        spell: { type: "psychicPower", experienceCost: 250 },
                        pr3: { type: "talent", name: "Power Rating", level: 3 },
                        pr2: { type: "talent", name: "Рейтинг Силы" },
                        talent: { type: "talent", name: "Combat Sense", level: 2 },
                    },
                    layouts: {},
                },
            },
        }, pathfinderCrusade);
        attachComputeds(testState());
    };

    it("halves a wizard's spells, rounded up, and prices Power Rating by the wizard's column", () => {
        load({ arcane: true });
        expect(cost("spell")).toBe(125);
        expect(cost("pr3")).toBe(500);
        // Without a level: PR 2, PR 1 is not bought.
        expect(cost("pr2")).toBe(250);
        expect(cost("talent")).toBe(500);
    });

    it("takes the cheapest column of the classes ticked", () => {
        load({ divine: true, spontaneous: true });
        expect(cost("spell")).toBe(250);
        expect(cost("pr3")).toBe(600);

        load({ arcane: true, divine: true });
        expect(cost("pr3")).toBe(500);
    });

    it("prices Power Rating by the elite archetypes' column without a PR class", () => {
        load({ bard: true });
        expect(cost("pr3")).toBe(800);
        expect(cost("pr2")).toBe(500);
    });

    it("leaves Black Crusade as it was", () => {
        loadState({
            experience: {
                experienceLog: {
                    items: {
                        spell: { type: "psychicPower", experienceCost: 250 },
                        pr3: { type: "talent", name: "Power Rating", level: 3 },
                    },
                    layouts: {},
                },
            },
        });
        attachComputeds(testState());
        expect(cost("spell")).toBe(250);
        expect(cost("pr3")).toBe(750);
    });
});
