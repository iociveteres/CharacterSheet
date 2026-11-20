// The forum's acceptance scenario (_prd/forum/requirements.md, "Готово, когда"):
// a topic, replies and a quote; unread topics and notifications of the others,
// replies merged into one, a quote that needs no subscription, the counter
// empty once read; a moderator closes and moves the topic, a banned user
// cannot write, and the ban is lifted at the end. Runs on the seeded forum:
// `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import {
    badge, canReply, closeIncidentNotice, createTopic, follow, forumSeed, idIn, liftBans, moderateTopic,
    deleteAndBan, openForum, openLastPage, openNotifications, openSection, openTopic, post, readAllNotifications, reply, sendReply, topicRow, uniqueTitle,
} from "../../lib/forum";

describe("forum: topic, replies, notifications, moderation", () => {
    let browser: Browser;
    let author: Player;
    let reader: Player;
    let gm: Player;
    let moderator: Player;
    const title = uniqueTitle("Acceptance");
    let topic = 0;
    let readerReply = 0;

    beforeAll(async () => {
        browser = await launch();
        author = await Player.create(browser, "author", { role: "player" });
        reader = await Player.create(browser, "reader", { role: "player2" });
        gm = await Player.create(browser, "gm", { role: "gm" });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        await closeIncidentNotice(author, reader, gm, moderator);
        // What an earlier run left unread.
        for (const p of [author, reader]) {
            await openNotifications(p);
            await readAllNotifications(p);
        }
    });

    afterAll(async () => {
        try {
            if (moderator) await liftBans(moderator, seedUser("player2").name);
        } finally {
            await browser?.close();
        }
    });

    it("starts a topic that another user sees unread", async () => {
        await openSection(author, forumSeed().section);
        ({ topic } = await createTopic(author, title, "Who has tried the **new forum**?"));
        // The one who starts a topic follows it (plan.md, decision 11).
        expect(await author.page.locator("button.forum-subscribe").getAttribute("aria-pressed")).toBe("true");

        await openSection(reader, forumSeed().section);
        expect(await topicRow(reader, topic).getAttribute("class")).toContain("unread");
        await openTopic(reader, topic);
        await openSection(reader, forumSeed().section);
        expect(await topicRow(reader, topic).getAttribute("class")).not.toContain("unread");
        expectNoErrors([author, reader]);
    });

    it("merges three replies into one notification of the topic's author", async () => {
        for (const p of [reader, gm, moderator]) {
            await openSection(p, forumSeed().section);
            await openTopic(p, topic);
            const id = await reply(p, `A reply of ${p.name}.`);
            if (p === reader) readerReply = id;
        }
        await openForum(author);
        expect(await badge(author)).toBe("1");
        const notes = await openNotifications(author);
        const unread = notes.filter(n => n.unread);
        expect(unread).toHaveLength(1);
        expect(unread[0].text).toContain("3 new replies");
        expect(unread[0].text).toContain(title);

        // The notification leads to the first reply; once it is read, the counter is empty.
        await follow(author.page, author.page.locator("ul.forum-notes > li.unread a.note-text"));
        expect(idIn(author.page.url(), "topic")).toBe(topic);
        expect(author.page.url()).toContain(`#post-${readerReply}`);
        await openForum(author);
        expect(await badge(author)).toBe("");
        expectNoErrors([author, reader, gm, moderator]);
    });

    it("notifies of a quote one who does not follow the topic, until they read it", async () => {
        await openSection(author, forumSeed().section);
        await openTopic(author, topic);
        await post(author, readerReply).locator("a.forum-quote-post").click();
        expect(await author.page.locator("#forum-reply-body").inputValue()).toContain(`(/forum/post/${readerReply})`);
        await sendReply(author);

        await openForum(reader);
        expect(await badge(reader)).toBe("1");
        const unread = (await openNotifications(reader)).filter(n => n.unread);
        expect(unread).toHaveLength(1);
        expect(unread[0].label).toContain("Quote");
        expect(unread[0].text).toContain(title);
        await follow(reader.page, reader.page.locator("ul.forum-notes > li.unread a.note-text"));
        expect(idIn(reader.page.url(), "topic")).toBe(topic);
        // Replying did not subscribe them (plan.md, decision 11).
        expect(await reader.page.locator("button.forum-subscribe").getAttribute("aria-pressed")).toBe("false");
        await openForum(reader);
        expect(await badge(reader)).toBe("");
        expectNoErrors([author, reader]);
    });

    it("lets a moderator close the topic and move it to another section", async () => {
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        await moderateTopic(moderator, "close", { reason: "Answered." });
        await moderateTopic(moderator, "move", { section: forumSeed().movedTo });
        expect(await moderator.page.locator(".forum-breadcrumbs a").last().getAttribute("href")).toBe(`/forum/section/${forumSeed().movedTo}`);

        await openSection(reader, forumSeed().movedTo);
        expect(await topicRow(reader, topic).count()).toBe(1);
        await openTopic(reader, topic);
        expect(await canReply(reader)).toBe(false);
        expect(await reader.page.locator(".forum-notice").count()).toBeGreaterThan(0);
        // A moderator still replies in a closed topic.
        expect(await canReply(moderator)).toBe(true);

        await openForum(author);
        expect(await badge(author)).toBe("2");
        const notes = (await openNotifications(author)).filter(n => n.unread);
        expect(notes.every(n => n.label.includes("Moderation")), JSON.stringify(notes)).toBe(true);
        expect(notes.find(n => n.text.includes("closed"))).toBeTruthy();
        expect(notes.find(n => n.text.includes("moved"))).toBeTruthy();
        expectNoErrors([author, reader, moderator]);
    });

    it("keeps a banned user from writing until the ban is lifted", async () => {
        await openSection(moderator, forumSeed().movedTo);
        await openTopic(moderator, topic);
        // The ban is a box of the delete window: it opens the terms and renames the button.
        await follow(moderator.page, post(moderator, readerReply).locator("a.forum-delete-post"));
        const button = moderator.page.locator("form.forum-delete button[type=submit]");
        expect(await moderator.page.locator(".forum-delete-ban").isVisible()).toBe(false);
        expect((await button.innerText()).trim()).toBe("Delete");
        await moderator.page.locator("#forum-ban-author").check();
        expect(await moderator.page.locator(".forum-delete-ban").isVisible()).toBe(true);
        expect((await button.innerText()).trim()).toBe("Delete and ban");
        await moderator.page.goBack();
        await deleteAndBan(moderator, readerReply, 1, "Testing the ban.");
        expect(await post(moderator, readerReply).getAttribute("class")).toContain("deleted-mod");

        // The ban and its reason stand at the top of every forum page; no form to write in.
        await openSection(reader, forumSeed().section);
        expect(await reader.page.locator(".forum-ban-notice").innerText()).toContain("Testing the ban.");
        expect(await reader.page.locator("a.forum-new-topic").count()).toBe(0);
        await openLastPage(reader, forumSeed().longTopic);
        expect(await canReply(reader)).toBe(false);
        expect(await reader.page.locator("a.forum-quote-post").count()).toBe(0);

        await liftBans(moderator, seedUser("player2").name);
        await openSection(reader, forumSeed().section);
        expect(await reader.page.locator(".forum-ban-notice").count()).toBe(0);
        expect(await reader.page.locator("a.forum-new-topic").count()).toBe(1);
        await openLastPage(reader, forumSeed().longTopic);
        expect(await canReply(reader)).toBe(true);
        expectNoErrors([reader, moderator]);
    });
});
