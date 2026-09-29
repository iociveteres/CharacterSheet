import { describe, expect, it } from "vitest";
import { BASE_PR, parseDamage, resolveDamage, type DamageMod } from "./damage";

const KEYS = ["WS", "BS", "S", "T", "Inf"];
const VALUES: { [ref: string]: number } = { WS: 5, BS: 3, S: 4, T: 3, Inf: 2, [BASE_PR]: 3 };
const valueOf = (ref: string) => VALUES[ref] ?? 0;

const mod = (expr: string, enabled = true): DamageMod => ({ expr, enabled });
const resolve = (base: string, ...mods: DamageMod[]) => resolveDamage(base, mods, KEYS, valueOf);

describe("parseDamage", () => {
    it("reads dice, numbers and references with their signs", () => {
        expect(parseDamage("2d10 + 3 - S.b", KEYS)).toEqual({
            terms: [
                { kind: "dice", count: 2, sides: 10 },
                { kind: "flat", value: 3 },
                { kind: "ref", ref: "S", factor: 1, roundUp: false, sign: -1 },
            ],
            invalid: [],
        });
    });

    it("takes the factors and rounding of the rulebooks, any case", () => {
        const ref = (text: string) => parseDamage(text, KEYS).terms[0];
        for (const half of ["½WS.b", "1/2 WS.b", "0.5ws.b", ".5 WS.b"]) {
            expect(ref(half)).toEqual({ kind: "ref", ref: "WS", factor: 0.5, roundUp: false, sign: 1 });
        }
        expect(ref("½WS.b▲")).toMatchObject({ roundUp: true });
        expect(ref("½WS.b▼")).toMatchObject({ roundUp: false });
        for (const twice of ["2×bPR", "2x bpr", "2*bPR", "2bPR"]) {
            expect(ref(twice)).toEqual({ kind: "ref", ref: BASE_PR, factor: 2, roundUp: false, sign: 1 });
        }
        expect(ref("inf.b")).toMatchObject({ ref: "Inf" });
    });

    it("takes the dashes of the rulebooks for minuses", () => {
        expect(parseDamage("1d10–2", KEYS).terms).toEqual([{ kind: "dice", count: 1, sides: 10 }, { kind: "flat", value: -2 }]);
        expect(parseDamage("−1", KEYS).terms).toEqual([{ kind: "flat", value: -1 }]);
    });

    it("lists the terms it cannot read as typed and skips a sign without a term", () => {
        expect(parseDamage("1d10+Ag.b + 2R", KEYS).invalid).toEqual(["Ag.b", "2R"]);
        expect(parseDamage("PR", KEYS).invalid).toEqual(["PR"]);
        expect(parseDamage("xS.b", KEYS).invalid).toEqual(["xS.b"]);
        expect(parseDamage("1d10+", KEYS)).toEqual({ terms: [{ kind: "dice", count: 1, sides: 10 }], invalid: [] });
        expect(parseDamage("", KEYS)).toEqual({ terms: [], invalid: [] });
    });
});

describe("resolveDamage", () => {
    it("adds the enabled modifiers to the base", () => {
        expect(resolve("1d10+2", mod("S.b"), mod("½WS.b"), mod("bPR", false))).toEqual({
            expression: "1d10+8",
            text: "1d10+8",
            parts: ["S.b +4", "½WS.b +2"],
            parsed: true,
        });
    });

    it("rounds a part down unless ▲, before its sign", () => {
        expect(resolve("1d10", mod("½BS.b▲")).expression).toBe("1d10+2");
        expect(resolve("1d10", mod("½BS.b")).expression).toBe("1d10+1");
        expect(resolve("1d10", mod("-½BS.b")).expression).toBe("1d10-1");
        expect(resolve("1d10", mod("1/3 BS.b")).expression).toBe("1d10+1");
    });

    it("adds dice of the same sides to the base's and others after them", () => {
        expect(resolve("1d10+2", mod("1d10")).expression).toBe("2d10+2");
        expect(resolve("1d10+2", mod("d5"), mod("1")).text).toBe("1d10+1d5+3");
        // Without references the expression is what it adds.
        expect(resolve("1d10", mod("2"), mod("1d5 + 1"), mod("-1"), mod("S.b+1")).parts).toEqual(["+2", "+1d5+1", "-1", "S.b+1 +5"]);
    });

    it("resolves references in the base, e.g. of thrown weapons", () => {
        expect(resolve("1d10–3+S.b").expression).toBe("1d10+1");
        expect(resolve("2d10+2×T.b").expression).toBe("2d10+6");
        expect(resolve("1d10-4").expression).toBe("1d10-4");
        expect(resolve("1d10+4-S.b").expression).toBe("1d10");
    });

    it("gives the alternative in brackets the modifiers too and rolls the first", () => {
        expect(resolve("1d10+6 [1d10+9]", mod("S.b"))).toEqual({
            expression: "1d10+10", text: "1d10+10 [1d10+13]", parts: ["S.b +4"], parsed: true,
        });
        expect(resolve("Выстрелы [L.Выстрелы]", mod("S.b")).text).toBe("Выстрелы [L.Выстрелы]");
    });

    it("keeps a base it cannot read as typed, without modifiers", () => {
        for (const base of ["Нет", "†", "1d5–1R", "[1d10+7]", "  "]) {
            expect(resolve(base, mod("S.b"))).toEqual({ expression: base.trim(), text: base.trim(), parts: [], parsed: false });
        }
    });

    it("skips a modifier it cannot read or with nothing in it", () => {
        expect(resolve("1d10", mod("S.b+Ag.b"), mod(""), mod("S.b"))).toEqual({
            expression: "1d10+4", text: "1d10+4", parts: ["S.b +4"], parsed: true,
        });
    });
});
