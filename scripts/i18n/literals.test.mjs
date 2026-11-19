import { describe, expect, it } from "vitest";
import { applyExceptions, countByFolder, findLiterals, loadExceptions } from "./literals.mjs";

const DIR = "scripts/i18n/testdata/literals";
const scanned = findLiterals([`${DIR}/ui`, `${DIR}/html`]);
const texts = file => scanned.literals.filter(l => l.file === `${DIR}/${file}`).map(l => `${l.line}: ${l.text}`);

describe("check:i18n literals", () => {
    it("finds JSX text, label props, DOM text and dialogs, but not t() or text without letters", () => {
        expect(texts("ui/App.tsx")).toEqual([
            "2: Loading",
            "3: Close dialog",
            "5: Delete it?",
            "6: Tooltip text",
            "7: Hello world",
            "8: Many",
            "8: One",
            "9: Search ${…} rows",
            "13: Pistol",
            "17: Pistol",
        ]);
    });

    it("finds template text and attributes, leaving out actions, comments, scripts, links and large texts", () => {
        expect(texts("html/page.html")).toEqual([
            "1: Login",
            "5: Hi, {…}.",
            "6: Send",
            "9: A portrait",
            "9: Type here",
        ]);
        expect(scanned.files).not.toContain(`${DIR}/html/about.en.html`);
        expect(scanned.files).not.toContain(`${DIR}/ui/App.test.tsx`);
    });

    it("drops excepted literals and warns of exceptions that match nothing in the scanned folders", () => {
        const { remaining, excepted, warnings } = applyExceptions(scanned, loadExceptions(`${DIR}/exceptions.txt`));
        expect(excepted).toBe(2);
        expect(remaining.some(l => l.text === "Pistol")).toBe(false);
        expect(warnings).toEqual([
            `${DIR}/exceptions.txt:5: expected "path glob | literal | reason"`,
            `${DIR}/exceptions.txt:3: ${DIR}/ui/*.tsx | Gone: matches no literal any more, remove it`,
        ]);
        const complete = applyExceptions(scanned, loadExceptions(`${DIR}/exceptions.txt`), { complete: true });
        expect(complete.warnings.some(w => w.includes("Elsewhere"))).toBe(true);
    });

    it("counts by the given folder and two levels below it", () => {
        expect(countByFolder([`${DIR}/ui`, `${DIR}/html`], scanned.files, scanned.literals)).toEqual([
            [`${DIR}/html`, 5],
            [`${DIR}/ui`, 10],
            [`${DIR}/ui/sheet/weapons`, 1],
        ]);
    });
});
