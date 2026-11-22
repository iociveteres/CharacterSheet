// The email of an account (_prd/account_name_email): the form of the Account page wants the
// current password and then shows the change pending until it is cancelled; the mover changes
// their email by the links of both mailboxes and takes the old address back by the revert link,
// which signs out a tab opened before. No email is read: the links carry the tokens the seed put
// in (cmd/seedtest/account.go); the Go tests of the handlers and models check the chain itself.
// Needs web-dev for the reset of the rate limits. Runs on the seeded users and uses up the
// mover's links: `npm run seed` again after it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { config, seed, seedUser } from "../../lib/config";
import { onLoginPage, resetLimits, signIn } from "../../lib/account";
import { follow, openAccount } from "../../lib/forum";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";

describe("changing the account email", () => {
    let browser: Browser;
    const mover = () => seed().account.mover;
    const pending = (p: Player): Locator => p.page.locator("#account-email form.account-email-pending");
    const shownEmail = async (p: Player) => (await p.page.locator("#account-email .account-email").innerText()).trim();

    /** Opens the page of a link of the mover's email, presses its button and leaves the page of what it did. */
    async function followLink(p: Player, step: "old" | "new" | "revert", token: string): Promise<void> {
        await p.page.goto(`${config.base}/account/email/${step}/token/${token}`);
        const link = p.page.locator(`.account-email-link[data-step="${step}"]`);
        expect(await link.getAttribute("data-state"), `the ${step} link before its button`).toBe("confirm");
        await follow(p.page, link.locator("input[type=submit]"));
        expect(await link.getAttribute("data-state"), `the ${step} link after its button`).toBe("done");
    }

    beforeAll(async () => {
        await resetLimits();
        browser = await launch();
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("wants the current password in the form, then shows the change pending until it is cancelled", async () => {
        const renamer = await Player.create(browser, "renamer", { role: "renamer" });
        // The form again with the error of the password.
        renamer.allowErrors(/status of 422/);
        const page = renamer.page;
        const newEmail = "renamer-new@seed.test";
        await openAccount(renamer);
        expect(await pending(renamer).count(), "no change pending after the seed").toBe(0);

        await follow(page, page.locator("#account-email a.account-email-change"));
        await page.fill("#email-new", newEmail);
        await page.fill("#email-password", "not the password");
        await follow(page, page.locator("form.account-email-form input[type=submit]"));
        expect(new URL(page.url()).pathname, "the form again").toBe("/account/email");
        expect(await page.locator("label.error[for=email-password]").count(), "the error of the password").toBe(1);
        expect(await page.locator("label.error[for=email-new]").count(), "no error of the address").toBe(0);

        expect(await page.inputValue("#email-new"), "the address kept").toBe(newEmail);
        await page.fill("#email-password", seed().password);
        await follow(page, page.locator("form.account-email-form input[type=submit]"));
        expect(new URL(page.url()).pathname, "back to the account").toBe("/account/view");
        expect(await pending(renamer).innerText(), "the change pending").toContain(newEmail);
        expect(await shownEmail(renamer), "the email until the links are followed").toBe(seedUser("renamer").email);

        await follow(page, pending(renamer).locator("button.account-email-cancel"));
        expect(new URL(page.url()).pathname).toBe("/account/view");
        expect(await pending(renamer).count(), "the change cancelled").toBe(0);
        expect(await shownEmail(renamer)).toBe(seedUser("renamer").email);
        expectNoErrors([renamer]);
    });

    it("changes the email by the links to the old and the new address: the new one signs in, the old one no longer", async () => {
        const mailbox = await Player.create(browser, "mailbox", { auth: "" });
        await followLink(mailbox, "old", mover().oldToken);
        await followLink(mailbox, "new", mover().newToken);

        const byOld = await signIn(browser, "by the old address", mover().email);
        expect(onLoginPage(byOld), "signed in by the old address").toBe(true);
        const byNew = await signIn(browser, "by the new address", mover().newEmail);
        expect(onLoginPage(byNew), "not signed in by the new address").toBe(false);
        await openAccount(byNew);
        expect(await shownEmail(byNew)).toBe(mover().newEmail);
        expectNoErrors([mailbox, byOld, byNew]);
    });

    it("takes the old address back by the revert link: it signs in, a tab opened before is signed out", async () => {
        // Signed in by the seed, before the change.
        const before = await Player.create(browser, "mover before", { role: "mover" });
        await openAccount(before);
        expect(await shownEmail(before), "the tab open on the new address").toBe(mover().newEmail);

        const mailbox = await Player.create(browser, "old mailbox", { auth: "" });
        await followLink(mailbox, "revert", mover().revertToken);

        const back = await signIn(browser, "by the address put back", mover().email);
        expect(onLoginPage(back), "not signed in by the address put back").toBe(false);
        await openAccount(back);
        expect(await shownEmail(back)).toBe(mover().email);

        await follow(before.page, before.page.locator("nav.site-wide a[href='/account/view']"));
        expect(onLoginPage(before), "the tab opened before the revert signed out").toBe(true);
        expectNoErrors([before, mailbox, back]);
    });
});
