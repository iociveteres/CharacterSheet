// The moderator's delete window (_prd/forum/extras, block 7): deleting a post of Seed GM also bans
// them and deletes their other posts of the last 24 hours, with one reason; the window points to
// their topics of the day; the log line of the day's posts restores them all at once. The window
// and the log fit a 375 px phone. The GM's ban is lifted at the end. Earlier runs' posts of the GM
// may still be within the day, so counts are read from the window. Runs on the seeded forum:
// `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import {
    closeIncidentNotice, createTopic, expectFits, follow, forumSeed, liftBans, openForum, openModItem, openNotifications,
    openSection, openTopic, post, readAllNotifications, reply, uniqueTitle,
} from "../../lib/forum";

const PHONE = { viewport: { width: 375, height: 812 }, phone: true };
const REASON = "Flooding the section.";

describe("forum: delete, ban and the author's day", () => {
    let browser: Browser;
    let gm: Player;
    let gmPhone: Player;
    let moderator: Player;
    let modPhone: Player;
    let topic = 0;
    let firstReply = 0;
    let lastReply = 0;
    /** The other posts of the day the window offers to delete. */
    let more = 0;
    const name = () => seedUser("gm").name;

    const form = (p: Player): Locator => p.page.locator("form.forum-delete");
    const recent = (p: Player): Locator => form(p).locator('input[name="recent"]');
    const logRow = (p: Player, text: RegExp): Locator => p.page.locator("ul.forum-mod-log > li").filter({ has: p.page.locator(".forum-log-what", { hasText: text }) });

    async function openDeleteWindow(p: Player): Promise<void> {
        await openSection(p, forumSeed().section);
        await openTopic(p, topic);
        await follow(p.page, post(p, lastReply).locator("a.forum-delete-post"));
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        gmPhone = await Player.create(browser, "gm phone", { role: "gm", ...PHONE });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        modPhone = await Player.create(browser, "moderator phone", { role: "moderator", ...PHONE });
        await closeIncidentNotice(gm, gmPhone, moderator, modPhone);
        await liftBans(moderator, name());
        await openNotifications(gm);
        await readAllNotifications(gm);
        // A topic and two replies of the GM: the first post goes only with its topic.
        await openSection(gm, forumSeed().section);
        ({ topic } = await createTopic(gm, uniqueTitle("A day of posts"), "First post of the day."));
        firstReply = await reply(gm, "Second post of the day.");
        lastReply = await reply(gm, "Third post of the day.");
    });

    afterAll(async () => {
        try {
            if (moderator) await liftBans(moderator, name());
        } finally {
            await browser?.close();
        }
    });

    it("offers the ban, the author's day and their topics in the window", async () => {
        await openDeleteWindow(moderator);
        expect((await form(moderator).locator(".forum-delete-author > legend").innerText()).trim()).toBe(`Author: ${name()}`);
        expect((await form(moderator).locator("label", { has: moderator.page.locator("#forum-ban-author") }).innerText()).trim()).toBe("Ban the author");
        const label = (await form(moderator).locator('label:has(input[name="recent"])').innerText()).trim();
        const offered = /^Also delete the author’s other posts of the last 24 hours \((\d+) more\)$/.exec(label);
        expect(offered, label).not.toBeNull();
        more = Number(offered![1]);
        expect(more, "at least the GM's other reply").toBeGreaterThanOrEqual(1);
        const topics = (await form(moderator).locator(".forum-delete-topics").innerText()).trim();
        expect(topics).toMatch(/^The author’s topics of this day \(\d+\) are deleted through each topic’s “Moderation” menu\.$/);

        // The box opens the term and the note and renames the button, without a script.
        await moderator.page.locator("#forum-ban-author").check();
        expect((await form(moderator).locator(".forum-delete-ban > .meta").innerText()).trim())
            .toBe("They will not write on the forum; they will see the reason at the top of every forum page.");
        expect((await form(moderator).locator(".forum-ban-terms label").allInnerTexts()).map(s => s.trim()))
            .toEqual(["1 day", "7 days", "30 days", "until lifted"]);
        expect(await form(moderator).locator('input[name="duration"]:checked').getAttribute("value")).toBe("1");

        await openDeleteWindow(modPhone);
        await expectFits(modPhone, "delete window");
        await modPhone.page.locator("#forum-ban-author").check();
        await recent(modPhone).check();
        await expectFits(modPhone, "delete window with the ban and the day ticked");
        expectNoErrors([moderator, modPhone]);
    });

    it("asks for a reason with the ban, then deletes the post and the day and bans the author", async () => {
        // A ban without a reason comes back with the window as it was and the error at the reason.
        moderator.allowErrors(/status of 422/);
        await recent(moderator).check();
        await follow(moderator.page, form(moderator).locator("button[type=submit]"));
        expect(await moderator.page.locator("#forum-ban-author").isChecked()).toBe(true);
        expect(await recent(moderator).isChecked()).toBe(true);
        expect(await moderator.page.locator("#forum-mod-reason[aria-invalid=true]").count()).toBe(1);
        await expectFits(moderator, "delete window with an error");

        await moderator.page.fill("#forum-mod-reason", REASON);
        await follow(moderator.page, form(moderator).locator("button[type=submit]"));
        for (const id of [firstReply, lastReply]) expect(await post(moderator, id).getAttribute("class"), `post ${id}`).toContain("deleted-mod");
        // The day's posts show the window's reason too.
        expect(await post(moderator, firstReply).innerText()).toContain(REASON);

        await openSection(gm, forumSeed().section);
        expect(await gm.page.locator(".forum-ban-notice").innerText()).toContain(REASON);
        expect(await gm.page.locator("a.forum-new-topic").count()).toBe(0);
        expectNoErrors([moderator, gm]);
    });

    it("writes one log line for the day and restores it all from there", async () => {
        await openForum(moderator);
        await openModItem(moderator, "/forum/mod/log");
        const plural = (n: number, what: string) => `${n} post${n === 1 ? "" : "s"} ${what}`;
        const deleted = logRow(moderator, new RegExp(`^${plural(more, "deleted")}: ${name()}$`)).first();
        expect(await deleted.count()).toBe(1);
        expect((await deleted.locator(".forum-log-reason").innerText()).trim()).toBe(`Reason: ${REASON}`);
        const restore = deleted.locator("button.forum-restore-recent");
        expect((await restore.innerText()).trim()).toBe("↺ Restore all");

        await openForum(modPhone);
        await openModItem(modPhone, "/forum/mod/log");
        await expectFits(modPhone, "log with Restore all");

        const id = await deleted.getAttribute("id");
        await follow(moderator.page, restore);
        expect(new URL(moderator.page.url()).hash).toBe(`#${id}`);
        expect(await moderator.page.locator(`#${id} button.forum-restore-recent`).count(), "nothing left to restore").toBe(0);
        expect(await logRow(moderator, new RegExp(`^${plural(more, "restored")}: ${name()}$`)).count()).toBeGreaterThan(0);

        // The day comes back; the post deleted from the window itself stays deleted.
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        expect(await post(moderator, firstReply).getAttribute("class")).not.toContain("deleted");
        expect(await post(moderator, lastReply).getAttribute("class")).toContain("deleted-mod");

        const texts = (await openNotifications(gm)).filter(n => n.unread).map(n => n.text);
        expect(texts).toContain(`A moderator restored ${more} of your posts`);
        await expectFits(gm, "notifications");
        await openNotifications(gmPhone);
        await expectFits(gmPhone, "notifications of the delete window");
        expectNoErrors([moderator, modPhone, gm, gmPhone]);
    });
});
