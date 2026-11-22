// The name of an account (_prd/account_name_email): the renamer renames themself in place on the
// Account page, a name another user has stays in the field with its error under it, and the
// former name is in the ▾ dropdown by the name, on the Account page and, for anyone, on the
// renamer's forum page. Needs web-dev for the reset of the rate limits. Runs on the seeded users:
// `npm run seed` again after it gives the renamer the seed name back without the history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { seedUser } from "../../lib/config";
import { resetLimits } from "../../lib/account";
import { closeSiteNotice, createTopic, forumSeed, openAccount, openAuthorPage, openSection, openTopic, uniqueTitle } from "../../lib/forum";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";

describe("renaming an account", () => {
    let browser: Browser;
    let renamer: Player;
    let reader: Player;
    // A name no earlier run left on someone: the seed gives the renamer theirs back.
    const newName = uniqueTitle("Renamer");
    const seedName = () => seedUser("renamer").name;

    const cell = (p: Player): Locator => p.page.locator("#account-name");
    const shownName = async (p: Player) => (await cell(p).locator(".account-name").innerText()).trim();
    const field = (p: Player): Locator => cell(p).locator("input.account-name-input");

    /** Opens the ▾ of `scope` by a click and reads the former names in its panel. */
    async function openFormerNames(scope: Locator): Promise<string[]> {
        const details = scope.locator("details.former-names");
        expect(await details.getAttribute("open"), "the dropdown closed before the click").toBeNull();
        await details.locator("summary.former-names-toggle").click();
        await details.locator(".former-names-panel").waitFor();
        const dates = await details.locator(".former-date").allInnerTexts();
        for (const d of dates) expect(d.trim(), "the date of a former name").not.toBe("");
        return (await details.locator(".former-name").allInnerTexts()).map(s => s.trim());
    }

    beforeAll(async () => {
        await resetLimits();
        browser = await launch();
        renamer = await Player.create(browser, "renamer", { role: "renamer" });
        reader = await Player.create(browser, "player", { role: "player" });
        await closeSiteNotice(renamer, reader);
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("renames the user in place by ✎ and Enter, and the new name stays after a reload", async () => {
        await openAccount(renamer);
        expect(await shownName(renamer)).toBe(seedName());
        expect(await cell(renamer).locator("details.former-names").count(), "no former names after the seed").toBe(0);

        await cell(renamer).locator("button.account-rename").click();
        await field(renamer).fill(newName);
        await field(renamer).press("Enter");
        await field(renamer).waitFor({ state: "detached" });
        expect(await shownName(renamer)).toBe(newName);

        await renamer.page.reload();
        expect(await shownName(renamer), "the name after a reload").toBe(newName);
        expectNoErrors([renamer]);
    });

    it("keeps a name another user has in the field with the error under it, and Esc keeps the name", async () => {
        // The refusal of PUT /account/name.
        renamer.allowErrors(/status of 422/);
        await cell(renamer).locator("button.account-rename").click();
        await field(renamer).fill(seedUser("gm").name);
        await field(renamer).press("Enter");
        const error = cell(renamer).locator("#account-name-error");
        await error.waitFor();
        expect((await error.innerText()).trim(), "the error under the field").not.toBe("");
        expect(await field(renamer).getAttribute("aria-invalid")).toBe("true");
        expect(await field(renamer).inputValue(), "the refused name kept for a fix").toBe(seedUser("gm").name);

        await field(renamer).press("Escape");
        await field(renamer).waitFor({ state: "detached" });
        expect(await error.count(), "the error gone with the field").toBe(0);
        expect(await shownName(renamer)).toBe(newName);
        expectNoErrors([renamer]);
    });

    it("shows the former name in the dropdown by the name on the Account page", async () => {
        await openAccount(renamer);
        expect(await openFormerNames(cell(renamer))).toEqual([seedName()]);
        await renamer.page.keyboard.press("Escape");
        expect(await cell(renamer).locator("details.former-names").getAttribute("open"), "closed by Esc").toBeNull();
        expectNoErrors([renamer]);
    });

    it("shows the former name to another user on the renamer's forum page", async () => {
        await openSection(renamer, forumSeed().section);
        const { topic, post } = await createTopic(renamer, uniqueTitle("New name"), "I go by another name now.");

        await openSection(reader, forumSeed().section);
        await openTopic(reader, topic);
        await openAuthorPage(reader, post);
        const head = reader.page.locator(".forum-user-name");
        expect((await head.locator("h2").innerText()).trim()).toBe(newName);
        expect(await openFormerNames(head)).toEqual([seedName()]);
        expectNoErrors([renamer, reader]);
    });
});
