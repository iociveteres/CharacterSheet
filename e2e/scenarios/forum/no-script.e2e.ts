// The forum without scripts: start a topic, reply and quote with forms and
// links only, the preview tabs answered by the server. Runs on the seeded
// forum: `npm run seed`. Task 7.4.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import {
    badge, closeIncidentNotice, createTopic, follow, forumSeed, idIn, openForum, openNotifications, openSection, openTopic, post,
    readAllNotifications, reply, sendReply, typeReply, uniqueTitle,
} from "../../lib/forum";

describe("forum without scripts", () => {
    let browser: Browser;
    let author: Player;
    let replier: Player;
    const title = uniqueTitle("No script");
    let topic = 0;
    let answer = 0;

    beforeAll(async () => {
        browser = await launch();
        author = await Player.create(browser, "author", { role: "outsider", javaScript: false });
        replier = await Player.create(browser, "replier", { role: "player2", javaScript: false });
        await closeIncidentNotice(author, replier);
        await openNotifications(replier);
        await readAllNotifications(replier);
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("starts a topic after a preview from the server", async () => {
        await openSection(author, forumSeed().section);
        await follow(author.page, author.page.locator("a.forum-new-topic"));
        await author.page.fill("#forum-topic-title", title);
        await author.page.fill("#forum-topic-body", "Does it work **without scripts**?");
        await follow(author.page, author.page.locator(".tab[data-tab=preview]"));
        expect(await author.page.locator("#forum-topic-body-preview strong").innerText()).toBe("without scripts");
        expect(await author.page.locator("#forum-topic-title").inputValue()).toBe(title);
        await follow(author.page, author.page.locator(".tab[data-tab=text]"));
        expect(await author.page.locator("#forum-topic-body").inputValue()).toBe("Does it work **without scripts**?");
        await follow(author.page, author.page.locator("form.forum-form button.f-primary"));
        topic = idIn(author.page.url(), "topic");
        expect(topic).toBeGreaterThan(0);
        expect(await author.page.locator("h2").first().innerText()).toContain(title);
        expectNoErrors([author]);
    });

    it("replies and quotes through the quote page", async () => {
        await openSection(replier, forumSeed().section);
        await openTopic(replier, topic);
        answer = await reply(replier, "It does.");

        await openSection(author, forumSeed().section);
        await openTopic(author, topic);
        await follow(author.page, post(author, answer).locator("a.forum-quote-post"));
        expect(new URL(author.page.url()).pathname).toBe(`/forum/post/${answer}/quote`);
        expect(await author.page.locator("#forum-reply-body").inputValue()).toContain(`(/forum/post/${answer})`);
        await typeReply(author, "\n\nThank you.");
        const mine = await sendReply(author);
        const quote = post(author, mine).locator(".forum-post-body blockquote");
        expect(await quote.locator(".quote-head a").getAttribute("href")).toBe(`/forum/post/${answer}`);
        expect(await quote.innerText()).toContain("It does.");
        expectNoErrors([author, replier]);
    });

    it("notifies the quoted user, who reads it without scripts", async () => {
        await openForum(replier);
        expect(await badge(replier)).toBe("1");
        await openNotifications(replier);
        await follow(replier.page, replier.page.locator("ul.forum-notes > li.unread a.note-text"));
        await openForum(replier);
        expect(await badge(replier)).toBe("");
        expectNoErrors([replier]);
    });
});
