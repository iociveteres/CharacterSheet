// The language switch in the nav: after Russian is picked, the room page
// loads the Russian dictionary; English brings the English one back. The
// room page has no nav, so the user picks the language on the rooms page and
// goes to the room from there. It reads no wording: the page's lang, the
// dictionary script and its language code, and that the sheet's labels
// differ between the two. The choice is saved to the account, so the
// scenario uses the seeded player2 and switches back at the end. Runs on the
// seeded room (`npm run seed`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Response } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";

interface PageLanguage {
    htmlLang: string;
    dictionary: string | undefined;
    scripts: string[];
}

describe("the language switch", () => {
    let browser: Browser;
    let p: Player;
    /** The dictionary scripts the page loaded since the last pick, with their status. */
    const loaded: { url: string; status: number }[] = [];
    const roomLink = () => p.page.locator(`a[href="/room/view/${seed().roomId}"]`).first();

    async function language(): Promise<PageLanguage> {
        return p.page.evaluate(() => ({
            htmlLang: document.documentElement.lang,
            dictionary: (window as { __I18N__?: { lang: string } }).__I18N__?.lang,
            scripts: Array.from(document.querySelectorAll<HTMLScriptElement>("script[src*='/i18n.']")).map(s => new URL(s.src).pathname),
        }));
    }

    /** The label of the sheet's Player tab. */
    const tabLabel = () => p.page.evaluate(() => window.__e2e.root().querySelector('label[for="show-player-sheet"]')?.textContent?.trim() ?? "");

    /** Picks `lang` in the nav of the rooms page and waits for the page it reloads. */
    async function choose(lang: "en" | "ru"): Promise<void> {
        await p.page.goto(`${p.base}/account/rooms`);
        loaded.length = 0;
        // The form posts and the server redirects back: one new document once it commits.
        await Promise.all([
            p.page.waitForEvent("framenavigated", f => f === p.page.mainFrame()),
            p.page.locator("#language-form select").selectOption(lang),
        ]);
        await p.page.waitForLoadState("load");
    }

    /** Goes to the room from the rooms page and opens the user's sheet from its list. */
    async function openRoomSheet(): Promise<void> {
        await roomLink().click();
        await p.page.waitForFunction(() => window.__e2e.socketOpen());
        await p.switchTo(seedUser("player2").sheetId!);
    }

    beforeAll(async () => {
        browser = await launch();
        p = await Player.create(browser, "player2", { role: "player2" });
        p.page.on("response", (r: Response) => {
            if (/\/static\/dist\/i18n\.\w+\.js/.test(r.url())) loaded.push({ url: new URL(r.url()).pathname, status: r.status() });
        });
    });

    afterEach(() => expectNoErrors([p]));

    afterAll(async () => {
        try {
            // A failed run must not leave the account in Russian.
            if (p && (await language()).htmlLang !== "en") await choose("en");
        } finally {
            await browser?.close();
        }
    });

    let englishLabel = "";

    it("the English room page has the English dictionary", async () => {
        await choose("en");
        await openRoomSheet();
        expect(await language()).toEqual({ htmlLang: "en", dictionary: "en", scripts: ["/static/dist/i18n.en.js"] });
        englishLabel = await tabLabel();
        expect(englishLabel).not.toBe("");
    });

    it("after Russian is picked the pages load the Russian dictionary", async () => {
        await choose("ru");
        expect(await language(), "the rooms page").toEqual({ htmlLang: "ru", dictionary: "ru", scripts: ["/static/dist/i18n.ru.js"] });
        expect(await p.page.locator("#language-form select").inputValue(), "the language chosen").toBe("ru");

        await openRoomSheet();
        expect(await language(), "the room page").toEqual({ htmlLang: "ru", dictionary: "ru", scripts: ["/static/dist/i18n.ru.js"] });
        expect(loaded.map(l => l.url), "dictionaries loaded").toEqual(["/static/dist/i18n.ru.js", "/static/dist/i18n.ru.js"]);
        for (const l of loaded) expect(l.status, l.url).toBeLessThan(400);
        const label = await tabLabel();
        expect(label, "the sheet's label in Russian").not.toBe("");
        expect(label, "the sheet's label in Russian").not.toBe(englishLabel);
    });

    it("English brings the English dictionary back", async () => {
        await choose("en");
        await openRoomSheet();
        expect(await language()).toEqual({ htmlLang: "en", dictionary: "en", scripts: ["/static/dist/i18n.en.js"] });
        expect(await tabLabel()).toBe(englishLabel);
    });
});
