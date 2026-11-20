// The forum as a user reaches it: links and buttons clicked, forms typed into
// and sent, menus opened by their own click. Runs on the seeded forum sections
// (`npm run seed`, cmd/seedtest/forum.go).
import { expect } from "vitest";
import type { Locator, Page } from "playwright-core";
import { seed } from "./config";
import type { Player } from "./player";

export const forumSeed = () => seed().forum;

/** A title no earlier run used: topics of earlier runs stay in the sections until the next seed. */
export const uniqueTitle = (what: string) => `${what} ${Date.now().toString(36)}`;

/** The topic or post id in a forum address, or 0. */
export const idIn = (url: string, kind: "topic" | "post"): number =>
    Number(new RegExp(`/forum/${kind}/(\\d+)`).exec(url)?.[1] ?? 0);

/** The id of the post an address points at: its anchor on a topic page. */
const postIn = (url: string) => Number(/#post-(\d+)/.exec(url)?.[1] ?? idIn(url, "post"));

/**
 * The site's incident notice stays closed, as for a user who closed it once
 * (the cookie its close button sets): on a phone it covers the form buttons,
 * and without scripts it cannot be closed.
 */
export async function closeIncidentNotice(...players: Player[]): Promise<void> {
    for (const p of players) await p.context.addCookies([{ name: "incident_notice_closed", value: "1", url: p.base }]);
}

/** Clicks what leads to another page and waits for that page. */
export async function follow(page: Page, target: Locator): Promise<void> {
    await Promise.all([page.waitForEvent("load"), target.click()]);
}

/** Opens the forum's home by the forum link of the site's nav. */
export async function openForum(p: Player): Promise<void> {
    if (!/\/forum\//.test(p.page.url())) await p.page.goto(`${p.base}/`);
    await follow(p.page, p.page.locator("nav.site-wide a[href='/forum/']"));
}

/** Opens section `id` from the forum's home. */
export async function openSection(p: Player, id: number): Promise<void> {
    await openForum(p);
    await follow(p.page, p.page.locator(`.forum-sections a.forum-row-title[href="/forum/section/${id}"]`));
}

/** The row of topic `id` in the list of the open section. */
export const topicRow = (p: Player, id: number) =>
    p.page.locator("ol.forum-topics > li.forum-row").filter({
        has: p.page.locator(`a.forum-row-title[href="/forum/topic/${id}"], a.forum-row-title[href="/forum/topic/${id}/unread"]`),
    });

/** Opens topic `id` by its title in the open section, at the first unread post if it has one. */
export async function openTopic(p: Player, id: number): Promise<void> {
    await follow(p.page, topicRow(p, id).locator("a.forum-row-title"));
    expect(idIn(p.page.url(), "topic")).toBe(id);
}

/** Opens the last page of topic `id` by its page links in the open section's list. */
export async function openLastPage(p: Player, id: number): Promise<void> {
    await follow(p.page, topicRow(p, id).locator(".forum-minipages a").last());
    expect(idIn(p.page.url(), "topic")).toBe(id);
}

/** Starts a topic in the open section and returns its id and the id of its first post. */
export async function createTopic(p: Player, title: string, body: string): Promise<{ topic: number; post: number }> {
    await follow(p.page, p.page.locator("a.forum-new-topic"));
    await p.page.fill("#forum-topic-title", title);
    await p.page.fill("#forum-topic-body", body);
    await follow(p.page, p.page.locator("form.forum-form button.f-primary"));
    const url = p.page.url();
    expect(idIn(url, "topic"), `a topic page after creating "${title}", got ${url}`).toBeGreaterThan(0);
    return { topic: idIn(url, "topic"), post: postIn(url) };
}

/** Adds `text` to the reply field of the open topic, after what is in it. */
export async function typeReply(p: Player, text: string): Promise<void> {
    const field = p.page.locator("#forum-reply-body");
    await field.click();
    await p.page.keyboard.press("Control+End");
    await p.page.keyboard.insertText(text);
}

/** Sends the reply form of the open page and returns the id of the new post. */
export async function sendReply(p: Player): Promise<number> {
    await follow(p.page, p.page.locator("form#reply button.f-primary"));
    const post = postIn(p.page.url());
    expect(post, `a post after replying, got ${p.page.url()}`).toBeGreaterThan(0);
    return post;
}

/** Replies `text` in the open topic and returns the id of the new post. */
export async function reply(p: Player, text: string): Promise<number> {
    await typeReply(p, text);
    return sendReply(p);
}

/** The card of post `id` on the open page. */
export const post = (p: Player, id: number) => p.page.locator(`article#post-${id}`);

/** Opens the forum page of the author of post `id` by their name at the post on the open page. */
export async function openAuthorPage(p: Player, id: number): Promise<void> {
    await follow(p.page, post(p, id).locator(".forum-post-author a.name"));
    expect(p.page.url()).toMatch(/\/forum\/user\/\d+/);
}

/** Opens the site's Account page by its link in the nav. */
export async function openAccount(p: Player): Promise<void> {
    if (!/^https?:/.test(p.page.url())) await p.page.goto(`${p.base}/`);
    await follow(p.page, p.page.locator("nav.site-wide a[href='/account/view']"));
}

/** The message the site shows at the top of a page after a form, "" for none. */
export async function flash(p: Player): Promise<string> {
    const box = p.page.locator(".flash");
    return (await box.count()) ? (await box.innerText()).trim() : "";
}

/** Whether the open page has a form to reply in. */
export const canReply = async (p: Player) => (await p.page.locator("form#reply").count()) > 0;

/** The number on the forum link of the site's nav: unread notifications, "" for none. */
export async function badge(p: Player): Promise<string> {
    const pill = p.page.locator("nav.site-wide .nav-badge");
    return (await pill.count()) ? (await pill.innerText()).trim() : "";
}

export interface Note { unread: boolean; label: string; text: string; href: string | null }

/** Opens the notifications by their button on the forum's home and reads them, newest first. */
export async function openNotifications(p: Player): Promise<Note[]> {
    await openForum(p);
    await follow(p.page, p.page.locator("a.forum-notifications"));
    return p.page.locator("ul.forum-notes > li").evaluateAll(rows => rows.map(li => {
        const text = li.querySelector<HTMLElement>(".note-text")!;
        return {
            unread: li.classList.contains("unread"),
            label: li.querySelector(".meta")!.textContent!.trim(),
            text: text.textContent!.trim(),
            href: text.getAttribute("href"),
        };
    }));
}

/** Marks every notification read on the open notifications page, if any is unread. */
export async function readAllNotifications(p: Player): Promise<void> {
    if (await p.page.locator("ul.forum-notes > li.unread").count()) {
        await follow(p.page, p.page.locator("button.forum-notifications-read"));
    }
}

/** Opens the moderation menu of the open page and the page of its item that links to `path`. */
export async function openModItem(p: Player, path: string): Promise<void> {
    await p.page.locator("details.forum-mod-menu > summary").click();
    await follow(p.page, p.page.locator(`.forum-menu-panel a[href$="${path}"]`));
}

/**
 * Takes moderator's action `action` on the open topic through its menu, with
 * `section` (the target of a move) and the reason.
 */
export async function moderateTopic(p: Player, action: "close" | "open" | "move" | "pin" | "unpin", { section, reason = "" }: { section?: number; reason?: string } = {}): Promise<void> {
    await openModItem(p, `/mod/${action}`);
    if (section) await p.page.selectOption("#forum-mod-section", String(section));
    if (reason) await p.page.fill("#forum-mod-reason", reason);
    await follow(p.page, p.page.locator("form.forum-mod-form button[type=submit]"));
}

/**
 * Deletes post `id` on the open page by its "Delete" and, in the delete window, bans its author
 * for `days` (0: for good) with the one reason; `recent` also ticks their other posts of 24 hours.
 */
export async function deleteAndBan(p: Player, id: number, days: 1 | 7 | 30 | 0, reason: string, { recent = false } = {}): Promise<void> {
    await follow(p.page, post(p, id).locator("a.forum-delete-post"));
    await p.page.fill("#forum-mod-reason", reason);
    await p.page.locator("#forum-ban-author").check();
    await p.page.locator(`.forum-ban-terms input[value="${days}"]`).check();
    if (recent) await p.page.locator('input[name="recent"]').check();
    await follow(p.page, p.page.locator("form.forum-delete button[type=submit]"));
}

/** Lifts the bans of `name` on the moderators' list of bans, reached from the forum's home. */
export async function liftBans(p: Player, name: string): Promise<void> {
    await openForum(p);
    await openModItem(p, "/forum/mod/bans");
    const row = () => p.page.locator("ul.forum-mod-bans > li").filter({ has: p.page.getByText(name, { exact: true }) });
    while (await row().count()) await follow(p.page, row().first().locator("button.forum-lift-ban"));
}

/** Lifts the avatar upload ban of `name` on the moderators' list of bans, if there is one. */
export async function liftAvatarLock(p: Player, name: string): Promise<void> {
    await openForum(p);
    await openModItem(p, "/forum/mod/bans");
    const row = p.page.locator("ul.forum-avatar-locks > li").filter({ has: p.page.getByText(name, { exact: true }) });
    if (await row.count()) await follow(p.page, row.locator("button.forum-lift-lock"));
}

/** Fails if anything on the open page reaches past the window's right edge or a scroll appears. */
export async function expectFits(p: Player, what = p.page.url()): Promise<void> {
    const { width, scroll, wide } = await p.page.evaluate(() => {
        const width = window.innerWidth;
        const wide: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
            const name = `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
            // A code block scrolls inside itself: its lines are measured by the block.
            if (el.tagName !== "PRE" && el.closest("pre")) continue;
            const box = el.getBoundingClientRect();
            if (box.width && (box.right > width + 0.5 || box.left < -0.5)) wide.push(`${name} ${Math.round(box.left)}..${Math.round(box.right)}`);
            // main.css lets <main> scroll: content wider than it would scroll sideways there, not the page.
            const overflow = getComputedStyle(el).overflowX;
            if (el.tagName !== "PRE" && (overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth + 1) {
                wide.push(`${name} scrolls ${el.scrollWidth} in ${el.clientWidth}`);
            }
        }
        return { width, scroll: document.documentElement.scrollWidth, wide: wide.slice(0, 5) };
    });
    expect(wide, `${what}: wider than ${width}px`).toEqual([]);
    expect(scroll, `${what}: page width`).toBeLessThanOrEqual(width);
}
