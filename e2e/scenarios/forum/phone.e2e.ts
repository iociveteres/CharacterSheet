// Every kind of forum page fits a 375×812 phone: no sideways scroll, nothing past
// the right edge, the site's header and nav included, with long words, addresses
// and code in the posts. Runs on the seeded forum: `npm run seed`. Task 7.2.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { closeIncidentNotice, createTopic, expectFits, follow, forumSeed, openForum, openNotifications, openSection, openTopic, post, setModMode, uniqueTitle } from "../../lib/forum";

const PHONE = { viewport: { width: 375, height: 812 }, phone: true };

const LONG_WORD = "Pneumonoultramicroscopicsilicovolcanoconiosis".repeat(4);
const LONG_URL = `https://example.com/${"very-long-path-segment-".repeat(8)}end?query=${"x".repeat(60)}`;
const BODY = [
    `A word longer than the screen: ${LONG_WORD}.`,
    `A bare address: ${LONG_URL}`,
    `Inline code: \`${"const value = compute(".repeat(5)}\``,
    "```",
    `${"let line = 'a code line far wider than a phone'; ".repeat(4)}`,
    "```",
    `> ${LONG_WORD}`,
    "",
    `||${LONG_WORD}||`,
].join("\n");

describe("forum on a phone", () => {
    let browser: Browser;
    let moderator: Player;
    let guest: Player;
    let topic = 0;
    let first = 0;

    beforeAll(async () => {
        browser = await launch();
        moderator = await Player.create(browser, "moderator", { role: "moderator", ...PHONE });
        guest = await Player.create(browser, "guest", { auth: "", ...PHONE });
        await closeIncidentNotice(moderator, guest);
        await setModMode(moderator, true);
        await openSection(moderator, forumSeed().section);
        // A title with no space to break at; a moderator is not held by the posting limits.
        ({ topic, post: first } = await createTopic(moderator, `${uniqueTitle("Phone")}${"W".repeat(100)}`, BODY));
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("fits the home page, the section and the topic", async () => {
        await openForum(moderator);
        await expectFits(moderator, "home");
        await moderator.page.locator("details.forum-mod-menu > summary").click();
        await expectFits(moderator, "home with the moderation menu");
        await openSection(moderator, forumSeed().section);
        await expectFits(moderator, "section");
        await openTopic(moderator, topic);
        await expectFits(moderator, "topic");
        // The post really has the long content, and the code block scrolls inside itself.
        const pre = post(moderator, first).locator("pre");
        expect(await pre.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        await moderator.page.locator("form#reply details.forum-hint > summary").click();
        await expectFits(moderator, "topic with the markup hint");
        await moderator.page.locator("details.forum-mod-menu > summary").click();
        await expectFits(moderator, "topic with the moderation menu");
        expectNoErrors([moderator]);
    });

    it("fits the forms: a new topic with an error, its preview, and the reply", async () => {
        await openSection(moderator, forumSeed().section);
        await follow(moderator.page, moderator.page.locator("a.forum-new-topic"));
        await expectFits(moderator, "new topic");
        // Too short a title comes back with its error under the field, status 422.
        moderator.allowErrors(/status of 422/);
        await moderator.page.fill("#forum-topic-title", "ab");
        await moderator.page.fill("#forum-topic-body", BODY);
        await follow(moderator.page, moderator.page.locator("form.forum-form button.f-primary"));
        expect(await moderator.page.locator("#forum-topic-title-error").count()).toBe(1);
        await expectFits(moderator, "new topic with an error");
        await moderator.page.locator("form.forum-form .tab[data-tab=preview]").click();
        await moderator.page.locator("#forum-topic-body-preview").waitFor();
        await expectFits(moderator, "new topic preview");
        expectNoErrors([moderator]);
    });

    it("fits the notifications and the moderators' pages", async () => {
        await openNotifications(moderator);
        await expectFits(moderator, "notifications");
        for (const page of ["/forum/mod/sections", "/forum/mod/log", "/forum/mod/bans"]) {
            await openForum(moderator);
            await moderator.page.locator("details.forum-mod-menu > summary").click();
            await follow(moderator.page, moderator.page.locator(`.forum-menu-panel a[href="${page}"]`));
            await expectFits(moderator, page);
        }
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        await moderator.page.locator("details.forum-mod-menu > summary").click();
        await follow(moderator.page, moderator.page.locator('.forum-menu-panel a[href$="/mod/move"]'));
        await expectFits(moderator, "move the topic");
        expectNoErrors([moderator]);
    });

    it("fits the pages a guest reads, with the header of a guest", async () => {
        await openSection(guest, forumSeed().section);
        await expectFits(guest, "section for a guest");
        await openTopic(guest, topic);
        await expectFits(guest, "topic for a guest");
        expectNoErrors([guest]);
    });
});
