// Pictures of forum posts under a spoiler and the "View" menu of the forum's home
// (_prd/forum/extras, blocks 2 and 8): a closed picture block asks its host for nothing, a click
// asks once; a picture that does not load gives its place to a line; the density and "Pictures
// at once" are cookies that survive a reload; the same pages fit a 375 px phone. The hosts are
// stood in for by page.route, so the run needs no network. Runs on the seeded forum: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator, Route } from "playwright-core";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { closeSiteNotice, createTopic, expectFits, forumSeed, openForum, openSection, openTopic, post, uniqueTitle } from "../../lib/forum";

const PHONE = { viewport: { width: 375, height: 812 }, phone: true };
const BODY = [
    "The map of the hall: ![Hall map](https://img.e2e.test/hall.png) as promised.",
    "",
    "![First](https://img.e2e.test/a.png) ![Second](https://cdn.e2e.test/b.png)",
    "",
    "||![Secret](https://img.e2e.test/secret.png)||",
    "",
    "![Gone](https://img.e2e.test/gone.png)",
].join("\n");

/** A 4×4 PNG, enough to load. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC", "base64");

describe("forum: pictures under a spoiler and the View menu", () => {
    let browser: Browser;
    let reader: Player;
    let phone: Player;
    let topic = 0;
    let first = 0;
    /** The picture paths each reader's page asked the stand-in hosts for. */
    const asked = new Map<Player, string[]>();

    /** Serves the pictures of the e2e hosts to `p`'s pages; gone.png is missing. */
    async function standInHosts(p: Player): Promise<void> {
        asked.set(p, []);
        await p.context.route(/^https:\/\/[a-z]+\.e2e\.test\//, (route: Route) => {
            const path = new URL(route.request().url()).pathname;
            asked.get(p)!.push(path);
            return path === "/gone.png" ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        });
        // The browser reports the missing picture in the console.
        p.allowErrors(/status of 404/);
    }

    const blocks = (p: Player): Locator => post(p, first).locator("details.forum-img-spoiler");
    const block = (p: Player, caption: string): Locator => blocks(p).filter({ has: p.page.locator("summary .cap", { hasText: caption }) });
    const viewMenu = (p: Player): Locator => p.page.locator("details.forum-view-menu");

    /** Opens the View menu of the forum's home and clicks its item `item`. */
    async function choose(p: Player, item: string): Promise<void> {
        await openForum(p);
        await viewMenu(p).locator("summary").click();
        await Promise.all([p.page.waitForEvent("load"), viewMenu(p).locator(item).click()]);
        expect(new URL(p.page.url()).pathname).toBe("/forum/");
    }

    async function openTheTopic(p: Player): Promise<void> {
        await openSection(p, forumSeed().section);
        await openTopic(p, topic);
    }

    beforeAll(async () => {
        browser = await launch();
        const moderator = await Player.create(browser, "moderator", { role: "moderator" });
        reader = await Player.create(browser, "reader", { role: "player" });
        phone = await Player.create(browser, "reader phone", { role: "player", ...PHONE });
        await closeSiteNotice(moderator, reader, phone);
        await standInHosts(reader);
        await standInHosts(phone);
        await openSection(moderator, forumSeed().section);
        ({ topic, post: first } = await createTopic(moderator, uniqueTitle("Pictures"), BODY));
        await moderator.close();
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("keeps every picture closed, asking no host, and opens one by a click", async () => {
        await openTheTopic(reader);
        expect(await blocks(reader).count()).toBe(4);
        expect(await blocks(reader).evaluateAll(ds => ds.map(d => (d as HTMLDetailsElement).open))).toEqual([false, false, false, false]);
        expect((await block(reader, "Hall map").locator("summary").innerText()).replace(/\s+/g, " ").trim()).toBe("🖼 Hall map img.e2e.test");
        expect((await block(reader, "pictures").locator("summary .cap").innerText()).trim()).toBe("🖼 2 pictures: First, Second");
        expect((await block(reader, "pictures").locator("summary .host").innerText()).trim()).toBe("img.e2e.test, cdn.e2e.test");
        expect((await blocks(reader).nth(2).locator("summary").innerText()).trim(), "a picture in a spoiler tells nothing").toBe("🖼 Spoiler");
        // The text around a picture stays in its paragraph, before and after the block.
        expect(await post(reader, first).locator(".forum-post-body").innerText()).toMatch(/The map of the hall:[\s\S]*as promised\./);
        await reader.page.waitForLoadState("networkidle");
        expect(asked.get(reader), "no picture asked for while closed").toEqual([]);

        await block(reader, "Hall map").locator("summary").click();
        const img = block(reader, "Hall map").locator("img.forum-img");
        await eventually(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), w => expect(w, "the picture loaded").toBe(4));
        expect(asked.get(reader)).toEqual(["/hall.png"]);
        expect(await img.getAttribute("referrerpolicy")).toBe("no-referrer");
        expect(await block(reader, "Hall map").locator("a.forum-img-link").getAttribute("href")).toBe("https://img.e2e.test/hall.png");
        expectNoErrors([reader]);
    });

    it("puts a line with the caption and host in place of a picture that does not load", async () => {
        await block(reader, "Gone").locator("summary").click();
        const broken = block(reader, "Gone").locator("a.forum-img-broken");
        await eventually(() => broken.isVisible(), shown => expect(shown, "the line of the broken picture").toBe(true));
        expect((await broken.innerText()).trim()).toBe("The picture did not load: Gone · img.e2e.test");
        expect(await block(reader, "Gone").locator("a.forum-img-link").isVisible()).toBe(false);
        expect(asked.get(reader)).toContain("/gone.png");
        expectNoErrors([reader]);
    });

    it("tells the picture's markup in the markup hint", async () => {
        await reader.page.locator("form#reply details.forum-hint > summary").click();
        const row = reader.page.locator("form#reply details.forum-hint tr").filter({ hasText: "![caption](https://…/picture.png)" });
        expect(await row.count()).toBe(1);
        expect((await row.locator("td").last().innerText()).trim()).toBe("🖼 a picture under a spoiler; the address is the file itself, not a page with it");
    });

    it("keeps the density chosen in the View menu over a reload", async () => {
        await openForum(reader);
        await viewMenu(reader).locator("summary").click();
        expect((await viewMenu(reader).locator("summary").innerText()).trim()).toBe("View ▾");
        const items = viewMenu(reader).locator(".forum-menu-panel button");
        expect((await items.allInnerTexts()).map(s => s.trim())).toEqual(["Larger", "Normal", "Compact", "Pictures at once"]);
        expect(await viewMenu(reader).locator("button[aria-current=true]").innerText()).toBe("Normal");
        expect(await viewMenu(reader).locator(".forum-images-toggle").getAttribute("aria-pressed")).toBe("false");

        await choose(reader, "button.forum-density-compact");
        expect(await reader.page.locator("#forum").getAttribute("class")).toBe("forum-compact");
        await reader.page.reload();
        expect(await reader.page.locator("#forum").getAttribute("class")).toBe("forum-compact");
        await openTheTopic(reader);
        expect(await reader.page.locator("#forum").getAttribute("class")).toBe("forum-compact");

        await choose(reader, "button.forum-density-large");
        await reader.page.reload();
        expect(await reader.page.locator("#forum").getAttribute("class")).toBe("forum-large");
        await viewMenu(reader).locator("summary").click();
        expect(await viewMenu(reader).locator("button[aria-current=true]").innerText()).toBe("Larger");

        // Normal is no cookie at all: #forum has no class.
        await choose(reader, "button.forum-density-normal");
        await reader.page.reload();
        expect(await reader.page.locator("#forum").getAttribute("class")).toBeNull();
        expectNoErrors([reader]);
    });

    it("opens the pictures at once over a reload, but not one the author hid in a spoiler", async () => {
        asked.set(reader, []);
        await choose(reader, "button.forum-images-toggle");
        await reader.page.reload();
        await viewMenu(reader).locator("summary").click();
        expect(await viewMenu(reader).locator(".forum-images-toggle").getAttribute("aria-pressed")).toBe("true");

        await openTheTopic(reader);
        expect(await blocks(reader).evaluateAll(ds => ds.map(d => (d as HTMLDetailsElement).open))).toEqual([true, true, false, true]);
        await eventually(async () => [...asked.get(reader)!].sort(), paths => expect(paths).toEqual(["/a.png", "/b.png", "/gone.png", "/hall.png"]));

        await choose(reader, "button.forum-images-toggle");
        await reader.page.reload();
        await openTheTopic(reader);
        expect(await blocks(reader).evaluateAll(ds => ds.filter(d => (d as HTMLDetailsElement).open).length)).toBe(0);
        expectNoErrors([reader]);
    });

    it("fits a phone: closed and open pictures, the View menu, the compact topic", async () => {
        await openTheTopic(phone);
        await expectFits(phone, "topic with closed pictures");
        for (const caption of ["Hall map", "pictures", "Gone"]) await block(phone, caption).locator("summary").click();
        await eventually(() => block(phone, "Gone").locator("a.forum-img-broken").isVisible(), shown => expect(shown).toBe(true));
        await expectFits(phone, "topic with open pictures and a broken one");

        await openForum(phone);
        await viewMenu(phone).locator("summary").click();
        await expectFits(phone, "home with the View menu");
        await choose(phone, "button.forum-density-compact");
        await openTheTopic(phone);
        await expectFits(phone, "compact topic");
        await choose(phone, "button.forum-images-toggle");
        await openTheTopic(phone);
        await expectFits(phone, "compact topic with the pictures at once");
        expectNoErrors([phone]);
    });
});
