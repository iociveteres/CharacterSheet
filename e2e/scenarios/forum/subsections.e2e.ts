// Forum subsections (_prd/forum/subsections): a moderator makes one inside the
// scenarios' section by «+ Subsection», a participant starts a topic in it by
// the section choice of the new topic form and finds both sections in the
// breadcrumbs; another participant sees the subsection unread on the home,
// folds its parent by the arrow and finds it still folded after a reload, then
// unfolded after unfolding and another reload. Runs on the seeded forum:
// `npm run seed`, which deletes the subsections of earlier runs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { closeIncidentNotice, follow, forumSeed, idIn, openForum, openModItem, openSection, setModMode, uniqueTitle } from "../../lib/forum";

describe("forum subsections", () => {
    let browser: Browser;
    let moderator: Player;
    let author: Player;
    let reader: Player;
    let parent = 0;
    let child = 0;
    let topic = 0;

    beforeAll(async () => {
        browser = await launch();
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        author = await Player.create(browser, "author", { role: "player" });
        reader = await Player.create(browser, "reader", { role: "player2" });
        await closeIncidentNotice(moderator, author, reader);
        await setModMode(moderator, true);
        parent = forumSeed().section;
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("lets a moderator add a subsection to a section by «+ Subsection»", async () => {
        const page = moderator.page;
        const name = uniqueTitle("Subsection");
        await openForum(moderator);
        await openModItem(moderator, "/forum/mod/sections");
        await follow(page, page.locator(`#section-${parent} a.forum-new-subsection`));
        expect(await page.locator("#forum-section-parent").inputValue()).toBe(String(parent));
        await page.fill("#forum-section-name", name);
        await follow(page, page.locator("form.forum-mod-form button[type=submit]"));

        // The list shows it under its parent, indented.
        const row = page.locator("li.forum-subrow").filter({ has: page.locator("a.forum-row-title", { hasText: name }) });
        child = Number(/\/forum\/section\/(\d+)/.exec(await row.locator("a.forum-row-title").getAttribute("href") ?? "")?.[1] ?? 0);
        expect(child).toBeGreaterThan(0);
        expect(await row.locator("a.forum-new-subsection").count()).toBe(0);
        expectNoErrors([moderator]);
    });

    it("starts a topic in the subsection by the section choice of the form", async () => {
        const page = author.page;
        await openSection(author, parent);
        // The parent lists its subsection above its own topics.
        expect(await page.locator(`ul.forum-sections a.forum-row-title[href="/forum/section/${child}"]`).count()).toBe(1);
        await follow(page, page.locator("a.forum-new-topic"));
        expect(await page.locator("#forum-topic-section").inputValue()).toBe(String(parent));
        await page.selectOption("#forum-topic-section", String(child));
        await page.fill("#forum-topic-title", uniqueTitle("In a subsection"));
        await page.fill("#forum-topic-body", "A topic of the subsection.");
        await follow(page, page.locator("form.forum-form button.f-primary"));
        topic = idIn(page.url(), "topic");
        expect(topic).toBeGreaterThan(0);

        const crumbs = await page.locator("nav.forum-breadcrumbs a").evaluateAll(links => links.map(a => a.getAttribute("href")));
        expect(crumbs).toEqual(["/forum/", `/forum/section/${parent}`, `/forum/section/${child}`]);
        expectNoErrors([author]);
    });

    it("folds the parent on the home by its arrow and keeps it folded after a reload", async () => {
        const page = reader.page;
        const parentRow = page.locator(`li.forum-parent[data-section="${parent}"]`);
        const childRow = page.locator(`li.forum-subrow[data-parent="${parent}"]`).filter({
            has: page.locator(`a.forum-row-title[href="/forum/section/${child}"]`),
        });
        const arrow = parentRow.locator("form.forum-fold button");
        const fold = async () => {
            await Promise.all([page.waitForResponse(r => r.url().endsWith("/forum/view/fold")), arrow.click()]);
        };

        await openForum(reader);
        expect(await parentRow.getAttribute("class")).not.toContain("folded");
        expect(await childRow.isVisible()).toBe(true);
        expect(await childRow.getAttribute("class")).toContain("unread");
        expect(await arrow.getAttribute("aria-expanded")).toBe("true");

        await fold();
        expect(await parentRow.getAttribute("class")).toContain("folded");
        expect(await childRow.isVisible()).toBe(false);
        expect(await arrow.getAttribute("aria-expanded")).toBe("false");
        // The folded parent names its subsections in a line, the unread one marked.
        const line = parentRow.locator(".forum-subsections");
        expect(await line.isVisible()).toBe(true);
        expect(await line.locator(`a.unread[href="/forum/section/${child}"]`).count()).toBe(1);

        await page.reload();
        expect(await parentRow.getAttribute("class")).toContain("folded");
        expect(await childRow.isVisible()).toBe(false);
        expect(await line.isVisible()).toBe(true);

        await fold();
        expect(await childRow.isVisible()).toBe(true);
        expect(await line.isVisible()).toBe(false);
        await page.reload();
        expect(await parentRow.getAttribute("class")).not.toContain("folded");
        expect(await childRow.isVisible()).toBe(true);
        expect(await line.isVisible()).toBe(false);
        expectNoErrors([reader]);
    });
});
