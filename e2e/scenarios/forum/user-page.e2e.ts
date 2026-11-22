// A forum user's page and their «About» (_prd/forum/extras, block 6): Seed Player 2 reaches their
// own page by their name at a post, writes «About» in forum markup, a moderator erases it with a
// reason from the page's moderation block, and the player reads that on the page and in a
// notification. The pages fit a 375 px phone. The player ends with «About» erased, which the next
// run starts from as well (the seed empties it). Runs on the seeded forum: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { closeSiteNotice, createTopic, expectFits, flash, follow, forumSeed, openAuthorPage, openNotifications, openSection, openTopic, readAllNotifications, reply, setModMode, uniqueTitle } from "../../lib/forum";

const PHONE = { viewport: { width: 375, height: 812 }, phone: true };
const ABOUT = "Plays **Dark Heresy** on Sundays.";
const REASON = "A link to a shop.";

describe("forum: the user page and «About»", () => {
    let browser: Browser;
    let player: Player;
    let phone: Player;
    let moderator: Player;
    let modPhone: Player;
    let topic = 0;
    let playerPost = 0;

    const about = (p: Player): Locator => p.page.locator("section.forum-user-about");
    const modAbout = (p: Player): Locator => p.page.locator(".forum-user-mod-about");

    /** Opens the player's page from their post in the test topic. */
    async function openPlayerPage(p: Player): Promise<void> {
        await openSection(p, forumSeed().section);
        await openTopic(p, topic);
        await openAuthorPage(p, playerPost);
    }

    beforeAll(async () => {
        browser = await launch();
        player = await Player.create(browser, "player2", { role: "player2" });
        phone = await Player.create(browser, "player2 phone", { role: "player2", ...PHONE });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        modPhone = await Player.create(browser, "moderator phone", { role: "moderator", ...PHONE });
        await closeSiteNotice(player, phone, moderator, modPhone);
        await setModMode(moderator, true);
        await setModMode(modPhone, true);
        await openNotifications(player);
        await readAllNotifications(player);
        await openSection(moderator, forumSeed().section);
        ({ topic } = await createTopic(moderator, uniqueTitle("Introductions"), "Say who you are."));
        await openSection(player, forumSeed().section);
        await openTopic(player, topic);
        playerPost = await reply(player, "Hello, all.");
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("shows the user their own page, reached by their name at a post", async () => {
        await openPlayerPage(player);
        expect((await player.page.locator(".forum-user-head h2").innerText()).trim()).toBe(seedUser("player2").name);
        expect((await player.page.locator(".forum-user-head .role").innerText()).trim()).toBe("Member");
        const facts = await player.page.locator(".forum-user-facts dt").allInnerTexts();
        expect(facts.map(s => s.trim())).toEqual(["Registered", "Posts", "Topics", "Last post"]);
        const own = player.page.locator(".forum-user-head p.meta").first();
        expect((await own.innerText()).trim()).toBe("This is your page. The name and the avatar are changed on the page “Account”.");
        expect(await own.locator("a").getAttribute("href")).toBe("/account/view#avatar");

        const tabs = player.page.locator(".forum-user-tabs a.tab");
        expect((await tabs.allInnerTexts()).map(s => s.trim().replace(/\d+/, "N"))).toEqual(["Posts · N", "Topics · N"]);
        expect(await player.page.locator(".forum-user-posts a.forum-row-title").first().innerText()).toContain("Introductions");
        await follow(player.page, tabs.nth(1));
        expect(new URL(player.page.url()).search).toBe("?tab=topics");
        expect(await tabs.nth(1).getAttribute("aria-current")).toBe("page");
        expect(await player.page.locator(".forum-user-mod").count(), "no moderation block for the user").toBe(0);
        expectNoErrors([player]);
    });

    it("lets the user write «About» in forum markup", async () => {
        await openPlayerPage(player);
        expect((await about(player).locator("h3").innerText()).trim()).toBe("About");
        const open = about(player).locator("details.forum-user-form > summary");
        expect((await open.innerText()).trim()).toBe("+ Tell about yourself");
        await open.click();
        const field = about(player).locator("textarea[name=about]");
        await field.click();
        await player.page.keyboard.insertText(ABOUT);
        await eventually(() => about(player).locator(".forum-form-buttons .meta").innerText(),
            text => expect(text.trim()).toBe(`${ABOUT.length} / 500 · forum markup`));

        await openPlayerPage(phone);
        await about(phone).locator("details.forum-user-form > summary").click();
        await expectFits(phone, "own page with the «About» form");

        await follow(player.page, about(player).locator("button[type=submit]"));
        expect(await flash(player)).toBe("Saved.");
        expect((await about(player).locator(".forum-post-body").innerText()).trim()).toBe("Plays Dark Heresy on Sundays.");
        expect(await about(player).locator(".forum-post-body strong").innerText()).toBe("Dark Heresy");
        expect((await about(player).locator("details.forum-user-form > summary").innerText()).trim()).toBe("✎ Edit");

        // Others read it.
        await openPlayerPage(moderator);
        expect((await about(moderator).locator(".forum-post-body").innerText()).trim()).toBe("Plays Dark Heresy on Sundays.");
        expectNoErrors([player, phone, moderator]);
    });

    it("lets a moderator erase «About» with a reason from the user's page", async () => {
        const block = moderator.page.locator(".forum-user-mod");
        expect((await block.locator("h3").innerText()).trim()).toBe("Moderation");
        expect((await block.locator(".what").allInnerTexts()).map(s => s.trim())).toEqual(["Ban", "Avatar", "About", "History"]);
        expect((await modAbout(moderator).locator(".state").innerText()).trim()).toBe(`set, ${ABOUT.length} characters`);
        await modAbout(moderator).locator("summary").click();
        expect((await modAbout(moderator).locator("summary").innerText()).trim()).toBe("⊖ Erase…");
        expect((await modAbout(moderator).locator("form .meta").innerText()).trim())
            .toBe("The text disappears from the page. The user gets a notification with the reason; the action goes to the moderation log.");

        await openPlayerPage(modPhone);
        await modAbout(modPhone).locator("summary").click();
        await expectFits(modPhone, "user page with the erase form");
        await modPhone.page.locator(".forum-user-mod-ban summary").click();
        await expectFits(modPhone, "user page with the ban form");

        await moderator.page.fill("#forum-erase-reason", REASON);
        await follow(moderator.page, modAbout(moderator).locator("form button[type=submit]"));
        expect(await flash(moderator)).toBe("“About” is erased.");
        expect(await about(moderator).count(), "an empty «About» shows to nobody else").toBe(0);
        const state = modAbout(moderator).locator(".state");
        expect((await state.innerText()).trim()).toMatch(/^erased · Seed Moderator, /);
        expect((await state.locator(".forum-ban-reason").innerText()).trim()).toBe(`Reason: ${REASON}`);
        expect(await moderator.page.locator(".forum-user-log > li").first().innerText()).toContain("“About” erased");

        // The log of this user only, from the link under the history.
        await follow(moderator.page, moderator.page.locator("a.forum-user-log-all"));
        expect((await moderator.page.locator(".forum-mod-log .forum-log-what").first().innerText()).trim()).toBe(`“About” erased: ${seedUser("player2").name}`);
        expect(await moderator.page.getByText("Actions on", { exact: false }).count()).toBeGreaterThan(0);
        await expectFits(moderator, "log of one user");
        await modPhone.page.reload();
        await follow(modPhone.page, modPhone.page.locator(".forum-user-tabs a.tab").nth(1));
        await expectFits(modPhone, "user page, the topics tab");
        await follow(modPhone.page, modPhone.page.locator("a.forum-user-log-all"));
        await expectFits(modPhone, "log of one user");
        expectNoErrors([moderator, modPhone]);
    });

    it("tells the user it was erased, why, and lets them write anew", async () => {
        const notes = (await openNotifications(player)).filter(n => n.unread);
        expect(notes.map(n => n.text)).toEqual(["A moderator erased your “About”"]);
        expect(notes[0].href).toMatch(/^\/forum\/user\/\d+#about$/);
        await follow(player.page, player.page.locator("ul.forum-notes > li.unread a.note-text"));
        const line = about(player).locator("p.meta");
        expect((await line.innerText()).trim()).toMatch(new RegExp(`^Erased by a moderator on .+\\. Reason: ${REASON.replace(/\./g, "\\.")}$`));
        expect((await about(player).locator("details.forum-user-form > summary").innerText()).trim()).toBe("+ Tell about yourself");

        await openPlayerPage(phone);
        await expectFits(phone, "own page with «About» erased");
        expectNoErrors([player, phone]);
    });
});
