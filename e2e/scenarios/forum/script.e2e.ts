// What the forum's script adds to the pages (ui/static/js/forum): the preview
// tabs without a reload in the three forms and the plain form when the preview
// request fails; Quote with a selection, of a whole post, twice in a row, and
// on a page without the reply form; the spoiler a click opens and closes.
// Runs on the seeded forum: `npm run seed`. _prd/forum/results/7.md, "Для B".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import {
    closeIncidentNotice, createTopic, follow, forumSeed, idIn, openSection, openTopic, post, reply, topicRow, typeReply, uniqueTitle,
} from "../../lib/forum";

const BODY = "The first paragraph has a **bold** word in it.\n\nThe second paragraph hides ||a secret||.";

describe("forum script", () => {
    let browser: Browser;
    let moderator: Player;
    let topic = 0;
    let first = 0;
    let second = 0;

    /** Leaves a mark on the page that a reload would wipe. */
    const markPage = () => moderator.page.evaluate(() => { (window as any).e2eSamePage = true; });
    const samePage = () => moderator.page.evaluate(() => (window as any).e2eSamePage === true);

    /**
     * Clicks the Preview tab of the form whose field is `field` and back, and
     * checks that the preview showed the text as a post without leaving the page.
     */
    async function previewInPlace(field: string, text: string): Promise<void> {
        const page = moderator.page;
        await page.locator(field).fill(text);
        await markPage();
        await page.locator(`form:has(${field}) .tab[data-tab=preview]`).click();
        await page.locator(`${field}-preview strong`).waitFor();
        expect(await page.locator(`${field}-preview strong`).innerText()).toBe("bold");
        expect(await page.locator(field).isHidden()).toBe(true);
        await page.locator(`form:has(${field}-preview) .tab[data-tab=text]`).click();
        expect(await page.locator(`${field}-preview`).count()).toBe(0);
        expect(await page.locator(field).inputValue()).toBe(text);
        expect(await samePage()).toBe(true);
    }

    beforeAll(async () => {
        browser = await launch();
        // A moderator is not held by the posting limits, and this file posts a lot.
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        await closeIncidentNotice(moderator);
        await openSection(moderator, forumSeed().section);
        ({ topic, post: first } = await createTopic(moderator, uniqueTitle("Script"), BODY));
        second = await reply(moderator, "A second post to quote whole.");
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("previews the new topic, the reply and the edit in place", async () => {
        await openSection(moderator, forumSeed().section);
        await follow(moderator.page, moderator.page.locator("a.forum-new-topic"));
        await previewInPlace("#forum-topic-body", "A **bold** start.");

        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        await previewInPlace("#forum-reply-body", "A **bold** reply.");

        await follow(moderator.page, post(moderator, second).locator("a.forum-edit-post"));
        await previewInPlace("#forum-edit-body", "A **bold** edit.");
        expectNoErrors([moderator]);
    });

    it("sends the form as without the script when the preview request fails", async () => {
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        await moderator.page.route("**/forum/preview", route => route.abort());
        moderator.allowErrors(/net::ERR_FAILED/);
        try {
            await typeReply(moderator, "A **bold** reply, previewed by the server.");
            await markPage();
            await follow(moderator.page, moderator.page.locator("form#reply .tab[data-tab=preview]"));
            expect(await samePage()).toBe(false);
            expect(await moderator.page.locator("#forum-reply-body-preview strong").innerText()).toBe("bold");
        } finally {
            await moderator.page.unroute("**/forum/preview");
        }
        expectNoErrors([moderator]);
    });

    it("quotes the selection, then a whole post, into the reply field", async () => {
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        await markPage();
        // A user's drag over "bold word" in the first paragraph.
        await post(moderator, first).locator(".forum-post-body p").first().evaluate(p => {
            const text = p.querySelector("strong")!.firstChild!;
            const after = p.querySelector("strong")!.nextSibling!;
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(after, " word".length);
            document.getSelection()!.removeAllRanges();
            document.getSelection()!.addRange(range);
        });
        await post(moderator, first).locator("a.forum-quote-post").click();
        const once = await moderator.page.locator("#forum-reply-body").inputValue();
        expect(once).toContain(`(/forum/post/${first})`);
        expect(once).toContain("**bold** word");
        expect(once).not.toContain("first paragraph");
        expect(once).not.toContain("second paragraph");

        // No selection: the whole post, after the first quote.
        await post(moderator, second).locator("a.forum-quote-post").click();
        const twice = await moderator.page.locator("#forum-reply-body").inputValue();
        expect(twice.startsWith(once)).toBe(true);
        expect(twice).toContain(`(/forum/post/${second})`);
        expect(twice).toContain("A second post to quote whole.");
        expect(twice.match(/\]\(\/forum\/post\/\d+\)/g)).toHaveLength(2);
        expect(await samePage()).toBe(true);
        expectNoErrors([moderator]);
    });

    it("leads Quote to the reply form on the last page from an earlier one", async () => {
        await openSection(moderator, forumSeed().section);
        await follow(moderator.page, topicRow(moderator, forumSeed().longTopic).locator(".forum-minipages a").first());
        expect(await moderator.page.locator("form#reply").count()).toBe(0);
        const firstOfLong = Number((await moderator.page.locator("article.forum-post").first().getAttribute("id"))!.slice("post-".length));
        await follow(moderator.page, post(moderator, firstOfLong).locator("a.forum-quote-post"));
        expect(new URL(moderator.page.url()).pathname).toBe(`/forum/post/${firstOfLong}/quote`);
        expect(idIn(await moderator.page.locator("form#reply").getAttribute("action") ?? "", "topic")).toBe(forumSeed().longTopic);
        expect(await moderator.page.locator("#forum-reply-body").inputValue()).toContain(`(/forum/post/${firstOfLong})`);
        expectNoErrors([moderator]);
    });

    it("opens and closes a spoiler by a click", async () => {
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        const spoiler = post(moderator, first).locator(".spoiler");
        expect(await spoiler.getAttribute("class")).not.toContain("open");
        await spoiler.click();
        expect(await spoiler.getAttribute("class")).toContain("open");
        await spoiler.click();
        expect(await spoiler.getAttribute("class")).not.toContain("open");
        expectNoErrors([moderator]);
    });
});
