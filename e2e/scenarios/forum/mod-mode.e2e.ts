// The forum's moderator mode (_prd/forum/moderator-mode): off by default, a moderator reads a topic
// as a member does — a deleted reply is a line, no moderation menu, no «Delete» on another's post.
// The item of «Moderation ▾» on the home turns it on: the band of the mode on every page, the deleted
// reply in full, the moderators' controls. «Turn off» on the band turns it off and comes back to the
// same page. Runs on the seeded forum: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import {
    closeIncidentNotice, createTopic, expectFits, follow, forumSeed, inModMode, openSection, openTopic, post, reply, setModMode, uniqueTitle,
} from "../../lib/forum";

const PHONE = { viewport: { width: 375, height: 812 }, phone: true };

describe("forum: moderator mode", () => {
    let browser: Browser;
    let author: Player;
    let moderator: Player;
    let modPhone: Player;
    let topic = 0;
    let standing = 0;
    let gone = 0;

    async function openTheTopic(p: Player): Promise<void> {
        await openSection(p, forumSeed().section);
        await openTopic(p, topic);
    }

    /** What the open topic shows of the moderators': the deleted reply's text, the menu, «Delete». */
    async function moderatorsControls(p: Player) {
        return {
            strip: await inModMode(p),
            deletedText: await post(p, gone).locator(".forum-post-body").count() > 0,
            stub: await p.page.locator(`article#post-${gone}.deleted-stub`).count() > 0,
            menu: await p.page.locator(".forum-topic-head details.forum-mod-menu").count() > 0,
            deleteOthers: await post(p, standing).locator("a.forum-delete-post").count() > 0,
        };
    }

    beforeAll(async () => {
        browser = await launch();
        author = await Player.create(browser, "author", { role: "player" });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        modPhone = await Player.create(browser, "moderator phone", { role: "moderator", ...PHONE });
        await closeIncidentNotice(author, moderator, modPhone);
        // A topic with two replies of the author; the second taken back by them.
        await openSection(author, forumSeed().section);
        ({ topic } = await createTopic(author, uniqueTitle("Moderator mode"), "The question."));
        standing = await reply(author, "A reply that stands.");
        gone = await reply(author, "A reply taken back.");
        await follow(author.page, post(author, gone).locator("a.forum-delete-post"));
        await follow(author.page, author.page.locator("form.forum-delete button[type=submit]"));
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("shows a moderator the topic as a member sees it while the mode is off", async () => {
        await openTheTopic(moderator);
        expect(await moderatorsControls(moderator)).toEqual({ strip: false, deletedText: false, stub: true, menu: false, deleteOthers: false });
        expectNoErrors([moderator]);
    });

    it("turns the mode on by the item of «Moderation ▾» on the home", async () => {
        await setModMode(moderator, true);
        expect(await inModMode(moderator)).toBe(true);
        expect((await moderator.page.locator(".forum-mod-mode strong").innerText()).trim()).toBe("Moderator mode");
        await openTheTopic(moderator);
        expect(await moderatorsControls(moderator)).toEqual({ strip: true, deletedText: true, stub: false, menu: true, deleteOthers: true });
        expect(await post(moderator, gone).locator(".forum-post-body").innerText()).toContain("A reply taken back.");
        expectNoErrors([moderator]);
    });

    it("turns the mode off by «Turn off» on the band, back on the same page", async () => {
        const here = moderator.page.url();
        await follow(moderator.page, moderator.page.locator(".forum-mod-mode button.forum-mod-mode-off"));
        expect(moderator.page.url()).toBe(here);
        expect(await moderatorsControls(moderator)).toEqual({ strip: false, deletedText: false, stub: true, menu: false, deleteOthers: false });
        expectNoErrors([moderator]);
    });

    it("keeps the band on one line at 375 px", async () => {
        await setModMode(modPhone, true);
        await openTheTopic(modPhone);
        const band = modPhone.page.locator(".forum-mod-mode");
        expect(await band.locator(".forum-mod-mode-note").isVisible()).toBe(false);
        const { height } = (await band.boundingBox())!;
        expect(height).toBeLessThan(48);
        await expectFits(modPhone);
        expectNoErrors([modPhone]);
    });
});
