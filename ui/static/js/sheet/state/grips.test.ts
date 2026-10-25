import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gripEffects, parseGrips, type Grip } from "./grips";

const ids = (text: string) => parseGrips(text).map(g => g.id);

// Every grip string of the melee weapons of both rulebooks, as of 2026-10-25.
const BOOK_GRIPS: { [text: string]: string[] } = {
    "1р": ["1h"],
    "1р [Об]": ["1h", "Rev"],
    "Л": ["Pa"],
    "П": ["Fa"],
    "1р [2р, Об, Бл, Мх]": ["1h", "2h", "Rev", "Cl", "Mh"],
    "1р [Об, Бл]": ["1h", "Rev", "Cl"],
    "1р [2р, Об]": ["1h", "2h", "Rev"],
    "1р [2р, Кл]": ["1h", "2h", "Fist"],
    "1р [2р]": ["1h", "2h"],
    "1р [2р, Бл]": ["1h", "2h", "Cl"],
    "2р [1р, Бл, Мх] ": ["2h", "1h", "Cl", "Mh"],
    "2р [Бл, Мх]": ["2h", "Cl", "Mh"],
    "2р [1р, Бл, 1р+Кл]": ["2h", "1h", "Cl", "1h+Fist"],
    "2р [1р, 1р+Кл]": ["2h", "1h", "1h+Fist"],
    "2р": ["2h"],
    "2р [1р]": ["2h", "1h"],
    "2р [1р, Бл, 1р+Об]": ["2h", "1h", "Cl", "1h+Rev"],
    "2р [Бл]": ["2h", "Cl"],
    "1р [Мх]": ["1h", "Mh"],
    "2р [1р, Бл, Мх]": ["2h", "1h", "Cl", "Mh"],
    "П+Л": ["Fa+Pa"],
    "Л+П": ["Fa+Pa"],
    "1р (2р)": ["1h", "2h"],
    "1р [1р, Бл, Мх]": ["1h", "Cl", "Mh"],
    "2р [Бл] ": ["2h", "Cl"],
    "1р+П": ["1h+Fa"],
    "1р [2р, Бл, Об]": ["1h", "2h", "Cl", "Rev"],
    "1р [Кл]": ["1h", "Fist"],
    "†": ["†"],
    "": [],
};

describe("the grip string", () => {
    it.each(Object.entries(BOOK_GRIPS))("%j reads as %j", (text, expected) => {
        expect(ids(text)).toEqual(expected);
    });

    it("reads the English keys as the Russian ones, in any case and with spaces", () => {
        expect(ids("2h [1h, Cl, 1h + Rev]")).toEqual(["2h", "1h", "Cl", "1h+Rev"]);
        expect(ids("1H [FIST]")).toEqual(["1h", "Fist"]);
        expect(ids("Ног")).toEqual(["Leg"]);
        expect(ids("Гол [Хв]")).toEqual(["Head", "Tail"]);
    });

    it("is one grip as typed, without effects, when a part reads as no grip", () => {
        expect(parseGrips("2р [Рог]")).toEqual([{ id: "2р [Рог]", keys: [] }]);
        expect(parseGrips("1р [2р")).toEqual([{ id: "1р [2р", keys: [] }]);
    });

    const assets = "internal/gamedata/assets/melee.json";
    it.runIf(existsSync(assets))("reads every grip of the gamedata but the footnote mark", () => {
        const weapons: { grip: string }[] = JSON.parse(readFileSync(assets, "utf8"));
        const unread = weapons.map(w => w.grip).filter(g => g.trim() && g.trim() !== "†" && parseGrips(g).some(grip => grip.keys.length === 0));
        expect(unread).toEqual([]);
    });
});

const grip = (id: string): Grip => parseGrips(id)[0];

describe("the effects of a grip", () => {
    it("of 1h and 2h count only as an alternative", () => {
        expect(gripEffects(grip("1h"), grip("1h"), false)).toMatchObject({ range: [], balance: [], damage: [], ws: [] });
        expect(gripEffects(grip("1h"), grip("2h"), false)).toMatchObject({
            range: [{ add: 1, end: "both" }], balance: [{ add: -1 }], damage: [{ expr: "die" }], ws: [{ add: -5 }],
        });
        expect(gripEffects(grip("2h"), grip("1h"), false).damage).toEqual([{ label: "2h", expr: "+3" }]);
        expect(gripEffects(grip("2h"), grip("2h"), false).damage).toEqual([]);
        // The primary 1р+П holds the 1h of its alternatives.
        expect(gripEffects(grip("1h+Fa"), grip("1h+Fa"), false).damage).toEqual([]);
    });

    it("are milder for a spear: 1h −1 Dmg and Balance −2, Rev keeps S.b", () => {
        const oneHand = gripEffects(grip("1h"), grip("2h"), true);
        expect(oneHand.damage).toEqual([{ label: "1h, spear", expr: "-1" }]);
        expect(oneHand.balance).toEqual([{ label: "1h, spear", add: -2 }]);
        expect(gripEffects(grip("Rev"), grip("1h"), true).halfStrength).toBe(false);
        expect(gripEffects(grip("Rev"), grip("1h"), false).halfStrength).toBe(true);
    });

    it("of Cl, Fist, Mh and Tail set values, add properties and limit the profiles", () => {
        expect(gripEffects(grip("Cl"), grip("2h"), false)).toMatchObject({
            range: [{ add: -2, end: "both" }], balance: [{ set: -2 }], properties: ["Precise"],
        });
        expect(gripEffects(grip("1h+Fist"), grip("2h"), false)).toMatchObject({
            range: [{ add: 1 }, { set: 0, end: "both" }], damage: [{ expr: "die" }, { expr: "-2" }], profiles: ["axe", "hook", "hammer"],
        });
        expect(gripEffects(grip("Mh"), grip("2h"), false)).toMatchObject({ mace: true, damage: [{ expr: "+3" }], ws: [{ add: -5 }] });
        expect(gripEffects(grip("Tail"), grip("Tail"), false)).toMatchObject({
            range: [{ set: 0, end: "min" }], balance: [{ set: -2 }], properties: ["Cheap Shot"],
        });
    });

    it.each(Object.keys(BOOK_GRIPS).filter(Boolean))("of each grip of %j: 1h and 2h only where the primary has not them", text => {
        const [primary, ...alternatives] = parseGrips(text);
        for (const g of [primary, ...alternatives]) {
            const fx = gripEffects(g, primary, false);
            const oneHand = g.keys.includes("1h") && !primary.keys.includes("1h");
            const twoHands = g.keys.includes("2h") && !primary.keys.includes("2h");
            expect(fx.ws.some(w => w.label === "1h")).toBe(oneHand);
            expect(fx.damage.some(d => d.label === "2h")).toBe(twoHands);
        }
    });

    it("of the limbs and of a string as typed are none", () => {
        for (const id of ["Fa", "Pa", "Fa+Pa", "Leg", "Head"]) {
            expect(gripEffects(grip(id), grip(id), false)).toMatchObject({ range: [], balance: [], damage: [], ws: [], properties: [] });
        }
        const typed = parseGrips("†")[0];
        expect(gripEffects(typed, typed, false)).toMatchObject({ range: [], balance: [], damage: [], ws: [] });
    });
});
