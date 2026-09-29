import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "./computed";
import { TECH_DAMAGE, statAt } from "./damage";
import { hardwareAt, hardwareName, neededHardware } from "./hardware";
import { characterState } from "./state";
import { updateSignalAtPath } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const P = "technoArcana.tabs.items.t1.powers.items.p1";
const list = (items: { [id: string]: object }) => ({
    list: { items, layouts: Object.fromEntries(Object.keys(items).map((id, i) => [id, pos(0, i)])) },
});

describe("the names of hardware", () => {
    it("read alike as the powers and the collections write them", () => {
        expect(hardwareName("Noospheric Uplink [Space Marine or Abhuman]")).toBe(hardwareName("Noospheric Uplink"));
        expect(hardwareName("Noospheric Emitters")).toBe(hardwareName("Noospheric Emitter"));
        expect(hardwareName("Medicae MCD")).toBe(hardwareName("Medicae Mechadendrite"));
    });

    it("leave to the players what the powers need in words", () => {
        expect(neededHardware("Ferric Lure Implants, Luminen Capacitors")).toEqual(["Ferric Lure Implants", "Luminen Capacitors"]);
        expect(neededHardware("2+ мехадендрита, Maglev Coils")).toEqual(["Maglev Coils"]);
        expect(neededHardware("Нет")).toEqual([]);
    });
});

describe("the hardware of a tech power", () => {
    beforeEach(() => {
        loadState({
            characteristics: { I: { value: "45" } },
            cybernetics: list({
                c1: { name: "Luminen Capacitors", quality: "Good" },
                c2: { name: "Ferric Lure Implants", quality: "Poor" },
                c3: { name: "Ferric Lure Implants", quality: "Best" },
            }),
            gear: list({ g1: { name: "Omnissiah Axe" } }),
            technoArcana: {
                tabs: {
                    items: { t1: { name: "Tab", powers: { items: { p1: { name: "Luminen Smite", implants: "Luminen Capacitors", damage: "2d10+2×I.b" } }, layouts: { p1: pos(0, 0) } } } },
                    layouts: { t1: pos(0, 0) },
                },
            },
        });
        attachComputeds(characterState);
    });

    afterEach(() => teardownSheet());

    it("takes the worst quality of the implants it needs, the best of those of one name", () => {
        expect(hardwareAt(P)).toEqual({ mod: 5, worst: { name: "Luminen Capacitors", quality: "Good" }, missing: [] });
        updateSignalAtPath(`${P}.implants`, "Luminen Capacitors, Ferric Lure Implants, Omnissiah Axe");
        // The Best of the two Ferric Lure Implants, a Common axe of the gear.
        expect(hardwareAt(P)).toEqual({ mod: 0, worst: null, missing: [] });
        updateSignalAtPath(`${P}.implants`, "Maglev Coils, Luminen Capacitors");
        expect(hardwareAt(P)).toMatchObject({ mod: 5, missing: ["Maglev Coils"] });
    });

    it("changes the I of the power's damage, while the sheet counts it", () => {
        // I 45 + 5: I.b 5.
        expect(statAt(TECH_DAMAGE, P, "damage").expression).toBe("2d10+10");
        updateSignalAtPath("settings.technoArcana.hardware", false);
        expect(statAt(TECH_DAMAGE, P, "damage").expression).toBe("2d10+8");
    });
});
