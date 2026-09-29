import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "./computed";
import { characterState } from "./state";
import { costText, parseCost, processAfterActivation, processes, techTraitsAt } from "./tech";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const path = (id: string) => `technoArcana.tabs.items.t1.powers.items.${id}`;

describe("parseCost", () => {
    it("reads the prices and Processes of the collection", () => {
        const cases: [string, { cognition: number; energy: number; x: boolean }][] = [
            ["3 ⚙", { cognition: 3, energy: 0, x: false }],
            ["2 ⚙, 1 🗲", { cognition: 2, energy: 1, x: false }],
            ["½ ⚙(У)", { cognition: 0.5, energy: 0, x: false }],
            ["1 ⚙, 2 🗲(У)", { cognition: 1, energy: 2, x: false }],
            ["½ (У)", { cognition: 0.5, energy: 0, x: false }],
            ["1", { cognition: 1, energy: 0, x: false }],
            ["Императив +2 ⚙", { cognition: 2, energy: 0, x: false }],
            ["Х ⚙", { cognition: 4, energy: 0, x: true }],
            ["X ⚙(У)", { cognition: 4, energy: 0, x: true }],
            ["Нет", { cognition: 0, energy: 0, x: false }],
            ["Да (У)", { cognition: 0, energy: 0, x: false }],
        ];
        for (const [text, cost] of cases) expect(parseCost(text, 4), text).toEqual(cost);
    });

    it("writes a cost as the rulebooks do", () => {
        expect(costText({ cognition: 2, energy: 1 })).toBe("2 ⚙, 1 🗲");
        expect(costText({ cognition: 0.5, energy: 0 })).toBe("½ ⚙");
        expect(costText({ cognition: 1.5, energy: 0 })).toBe("1½ ⚙");
        expect(costText({ cognition: 0, energy: 2 })).toBe("2 🗲");
        expect(costText({ cognition: 0, energy: 0 })).toBe("0 ⚙");
    });
});

describe("the Processes", () => {
    beforeEach(() => {
        loadState({
            technoArcana: {
                tabs: {
                    items: {
                        t1: {
                            name: "Tab",
                            powers: {
                                items: {
                                    shield: { name: "Voltagheist Shield", price: "1 ⚙, 1 🗲", process: "½ ⚙(У)", inProcess: { copies: 1 } },
                                    fortress: { name: "Unseen Fortress", price: "4 ⚙, 1 🗲", process: "1 ⚙", inProcess: { copies: 2 } },
                                    mask: { name: "Holographic Mask", price: "Х ⚙", process: "Х ⚙(У)", inProcess: { copies: 1, x: 3 } },
                                    fulgurite: { name: "Doctrina Fulgurite", subtypes: "Доктрина", price: "3 ⚙", process: "½ ⚙", inProcess: { copies: 1 } },
                                    seraph: { name: "Doctrina Seraph", subtypes: "Доктрина, Компенсатор (1)", price: "2 ⚙, 1 🗲", process: "1 ⚙" },
                                    shock: { name: "Luminen Shock", price: "1 ⚙, 1 🗲", process: "Нет", test: "Автоматически" },
                                },
                                layouts: {
                                    shield: pos(0, 0), fortress: pos(0, 1), mask: pos(0, 2), fulgurite: pos(0, 3), seraph: pos(0, 4), shock: pos(0, 5),
                                },
                            },
                        },
                    },
                    layouts: { t1: pos(0, 0) },
                },
            },
        });
        attachComputeds(characterState);
    });

    afterEach(() => teardownSheet());

    it("cost each turn what their copies cost at the X of the activation, a part of the total rounded up", () => {
        const { powers, total } = processes();
        expect(powers.map(p => [p.name, p.copies, costText(p.cost)])).toEqual([
            ["Voltagheist Shield", 1, "½ ⚙"],
            ["Unseen Fortress", 2, "2 ⚙"],
            ["Holographic Mask", 1, "3 ⚙"],
            ["Doctrina Fulgurite", 1, "½ ⚙"],
        ]);
        expect(total).toEqual({ cognition: 6, energy: 0 });
    });

    it("take another copy of a power, one at most of a unique one, and one Doctrine", () => {
        expect(processAfterActivation(path("fortress"), 0)).toEqual(new Map([[path("fortress"), { copies: 3, x: 0 }]]));
        expect(processAfterActivation(path("shield"), 0)).toEqual(new Map([[path("shield"), { copies: 1, x: 0 }]]));
        expect(processAfterActivation(path("seraph"), 0)).toEqual(new Map([
            [path("seraph"), { copies: 1, x: 0 }],
            [path("fulgurite"), { copies: 0 }],
        ]));
        expect(processAfterActivation(path("shock"), 0).size).toBe(0);
    });

    it("know a power tested automatically", () => {
        expect(techTraitsAt(path("shock")).auto).toBe(true);
        expect(techTraitsAt(path("shield")).auto).toBe(false);
    });
});
