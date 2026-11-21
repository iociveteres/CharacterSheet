// The site's avatar on the Account page and beside forum posts (_prd/forum/extras, blocks 4–6):
// Seed Player 2, who has none after a seed, uploads one, replaces and deletes it, and the post
// shows each; then a moderator removes it from their forum page with an upload ban, the player
// reads the ban on Account and in a notification, and the ban is lifted. The same pages fit a
// 375 px phone. The player ends as the seed leaves them: no avatar, no ban. Texts are the
// English catalog's (Player.create sets lang=en). Runs on the seeded forum: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { pickFile, pngFile, type FilePayload } from "../../lib/portrait";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { closeIncidentNotice, createTopic, expectFits, flash, follow, forumSeed, liftAvatarLock, openAccount, openAuthorPage, openForum, openModItem, openNotifications, openSection, openTopic, post, readAllNotifications, reply, setModMode, uniqueTitle } from "../../lib/forum";

const PHONE = { viewport: { width: 375, height: 812 }, phone: true };
const REASON = "An advert in the picture.";

describe("forum: avatars", () => {
    let browser: Browser;
    let player: Player;
    let phone: Player;
    let moderator: Player;
    let modPhone: Player;
    let topic = 0;
    let playerPost = 0;
    let first: FilePayload;
    let second: FilePayload;
    const name = () => seedUser("player2").name;

    const box = (p: Player): Locator => p.page.locator("#avatar");
    const frame = (p: Player): Locator => box(p).locator(".crop-box.avatar");
    const pop = (p: Player): Locator => box(p).locator(".crop-pop");
    const side = (p: Player): Locator => box(p).locator(".avatar-side > p").first();
    const postAvatar = (p: Player): Locator => post(p, playerPost).locator(".forum-post-author .forum-avatar");
    const modRow = (p: Player): Locator => p.page.locator(".forum-user-mod-avatar");

    /** The saved avatar's URL in the Account frame, once the upload is answered. */
    async function savedURL(p: Player): Promise<string> {
        return eventually(async () => (await frame(p).locator("img").getAttribute("src")) ?? "", src => expect(src, "the saved avatar").toMatch(/^\/avatar\/[0-9a-f]{16}$/));
    }

    /** Saves the open crop window and returns the new avatar's URL. */
    async function save(p: Player, before: string | null): Promise<string> {
        await pop(p).locator(".crop-save:enabled").click();
        await pop(p).waitFor({ state: "detached" });
        return eventually(() => savedURL(p), url => expect(url, "a new avatar").not.toBe(before));
    }

    /** The player's post in the test topic, opened from its section, and the src of its avatar ("" for the letter). */
    async function avatarAtPost(p: Player): Promise<string> {
        await openSection(p, forumSeed().section);
        await openTopic(p, topic);
        const avatar = postAvatar(p);
        if ((await avatar.getAttribute("class"))!.includes("letter")) return "";
        return (await avatar.locator("img").getAttribute("src"))!;
    }

    beforeAll(async () => {
        browser = await launch();
        player = await Player.create(browser, "player2", { role: "player2" });
        phone = await Player.create(browser, "player2 phone", { role: "player2", ...PHONE });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        modPhone = await Player.create(browser, "moderator phone", { role: "moderator", ...PHONE });
        await closeIncidentNotice(player, phone, moderator, modPhone);
        await setModMode(moderator, true);
        await setModMode(modPhone, true);
        // A run that failed halfway may have left the ban.
        await liftAvatarLock(moderator, name());
        await openNotifications(player);
        await readAllNotifications(player);
        first = await pngFile(player.page, 800, 600, "first.png");
        second = await pngFile(player.page, 500, 900, "second.png");

        await openSection(moderator, forumSeed().section);
        ({ topic } = await createTopic(moderator, uniqueTitle("Avatars"), "Show your faces."));
        await openSection(player, forumSeed().section);
        await openTopic(player, topic);
        playerPost = await reply(player, "Here is mine.");
    });

    afterAll(async () => {
        try {
            if (moderator) await liftAvatarLock(moderator, name());
        } finally {
            await browser?.close();
        }
    });

    it("uploads, replaces and deletes the avatar on Account, and the post shows each", async () => {
        await openAccount(player);
        if (await frame(player).locator("img").count()) {
            // A run that failed before deleting it.
            await frame(player).click();
            await pop(player).locator(".crop-delete").click();
            await pop(player).locator(".crop-delete-yes").click();
            await pop(player).waitFor({ state: "detached" });
        }
        expect((await box(player).locator("h2").innerText()).trim()).toBe("Avatar");
        expect((await frame(player).innerText()).trim()).toBe("+ Avatar");
        expect(await frame(player).getAttribute("title")).toBe("Upload an avatar (or drop an image here)");
        expect((await side(player).innerText()).trim()).toBe("No avatar: the forum shows the first letter of your name beside your posts. Click the frame or drop an image on it.");
        expect((await box(player).locator(".avatar-side .hint").innerText()).trim()).toBe("PNG, JPEG or WebP: you crop it to a square in the window.");
        expect(await avatarAtPost(player)).toBe("");
        expect((await postAvatar(player).innerText()).trim()).toBe(name()[0]);

        await openAccount(player);
        await pickFile(player.page, frame(player), first);
        expect(await pop(player).getAttribute("aria-label")).toBe("Avatar");
        expect((await pop(player).locator(".crop-choose").innerText()).trim()).toBe("Choose file…");
        expect(await pop(player).locator(".crop-delete").count(), "no Delete for a new avatar").toBe(0);
        const url = await save(player, null);
        expect((await side(player).innerText()).trim()).toBe("Everyone sees it beside your posts on the forum, guests too. Click the picture to replace or delete it.");
        expect(await frame(player).getAttribute("title")).toBe("Change the avatar");
        // Public and served as cropped: 192×192.
        const res = await player.context.request.get(`${player.base}${url}`);
        expect(res.status()).toBe(200);
        expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(await avatarAtPost(player)).toBe(url);
        expect(await postAvatar(player).locator("img").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([192, 192]);

        // Replaced from the window of the saved one; the reload keeps it.
        await openAccount(player);
        await frame(player).click();
        await pickFile(player.page, pop(player).locator(".crop-choose"), second);
        const replaced = await save(player, url);
        await player.page.reload();
        expect(await savedURL(player)).toBe(replaced);
        expect(await avatarAtPost(player)).toBe(replaced);

        // Deleted after the question: Keep keeps it, Delete removes it.
        await openAccount(player);
        await frame(player).click();
        await pop(player).locator(".crop-delete").click();
        expect((await pop(player).locator(".crop-footer .question").innerText()).trim()).toBe("Delete the avatar?");
        await pop(player).locator(".crop-keep").click();
        await pop(player).locator(".crop-cancel").click();
        expect(await savedURL(player)).toBe(replaced);
        await frame(player).click();
        await pop(player).locator(".crop-delete").click();
        await pop(player).locator(".crop-delete-yes").click();
        await pop(player).waitFor({ state: "detached" });
        await eventually(() => frame(player).innerText(), text => expect(text.trim()).toBe("+ Avatar"));
        expect(await avatarAtPost(player)).toBe("");
        expect((await player.context.request.get(`${player.base}${replaced}`)).status(), "the deleted image").toBe(404);
        expectNoErrors([player]);
    });

    it("fits Account on a phone, with the crop window over the screen", async () => {
        await openAccount(phone);
        await expectFits(phone, "account without an avatar");
        await pickFile(phone.page, frame(phone), first);
        await pop(phone).locator(".crop-save:enabled").waitFor();
        await expectFits(phone, "account with the crop window");
        await save(phone, null);
        await expectFits(phone, "account with an avatar");
        expect(await avatarAtPost(phone)).toMatch(/^\/avatar\//);
        await expectFits(phone, "topic with the avatar at a post");
        await follow(phone.page, post(phone, playerPost).locator("a.forum-edit-post"));
        expect(await phone.page.locator(".forum-avatar img").count(), "the own avatar in the edit form").toBe(1);
        await expectFits(phone, "edit form with the avatar");
        expectNoErrors([phone]);
    });

    it("lets a moderator remove the avatar with an upload ban from the user's page", async () => {
        const url = await avatarAtPost(player);
        expect(url).toMatch(/^\/avatar\//);

        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        expect(await postAvatar(moderator).locator("img").getAttribute("src")).toBe(url);
        await openAuthorPage(moderator, playerPost);
        expect((await modRow(moderator).locator(".what").innerText()).trim()).toBe("Avatar");
        expect((await modRow(moderator).locator(".state").innerText()).trim()).toBe("set");
        await modRow(moderator).locator("summary").click();
        expect((await modRow(moderator).locator("summary").innerText()).trim()).toBe("⊖ Remove the avatar…");
        expect((await modRow(moderator).locator("form .meta").innerText()).trim())
            .toBe("The avatar disappears from every post at once. The user gets a notification with the reason; the action goes to the moderation log.");
        expect((await modRow(moderator).locator("legend").innerText()).trim()).toBe("Forbid uploading a new one");
        expect((await modRow(moderator).locator(".forum-ban-terms label").allInnerTexts()).map(s => s.trim()))
            .toEqual(["do not forbid", "7 days", "30 days", "forever"]);
        expect(await modRow(moderator).locator('input[name="lock"]:checked').getAttribute("value")).toBe("none");

        await openSection(modPhone, forumSeed().section);
        await openTopic(modPhone, topic);
        await openAuthorPage(modPhone, playerPost);
        await modRow(modPhone).locator("summary").click();
        await expectFits(modPhone, "user page with the remove avatar form");

        await modRow(moderator).locator('input[name="lock"][value="7"]').check();
        await moderator.page.fill("#forum-avatar-reason", REASON);
        await follow(moderator.page, modRow(moderator).locator("form button[type=submit]"));
        expect(await flash(moderator)).toBe("The avatar is removed.");
        const state = modRow(moderator).locator(".state");
        expect((await state.innerText()).trim()).toMatch(/^removed, no new one until .+ · Seed Moderator, /);
        expect((await state.locator(".forum-ban-reason").innerText()).trim()).toBe(`Reason: ${REASON}`);
        expect(await modRow(moderator).locator("button.forum-lift-lock").innerText()).toBe("Lift the upload ban");
        const history = await moderator.page.locator(".forum-user-log > li").first().innerText();
        expect(history).toContain("Avatar removed");
        expect(history).toMatch(/, Upload ban until /);
        await expectFits(moderator, "user page with a lock");
        await modPhone.page.reload();
        await expectFits(modPhone, "user page with a lock");
        expect((await player.context.request.get(`${player.base}${url}`)).status(), "the removed image").toBe(404);

        // The post shows the letter; the list of bans has the lock.
        expect(await avatarAtPost(player)).toBe("");
        await openForum(moderator);
        await openModItem(moderator, "/forum/mod/bans");
        expect(await moderator.page.getByRole("heading", { name: "Avatar upload bans", exact: true }).count()).toBe(1);
        const lock = moderator.page.locator("ul.forum-avatar-locks > li").filter({ has: moderator.page.getByText(name(), { exact: true }) });
        expect(await lock.locator(".forum-ban-reason").innerText()).toBe(`Reason: ${REASON}`);
        expectNoErrors([player, moderator, modPhone]);
    });

    it("shows the user the ban on Account and in a notification", async () => {
        const notes = (await openNotifications(player)).filter(n => n.unread);
        expect(notes).toHaveLength(1);
        expect(notes[0].label).toContain("Moderation");
        expect(notes[0].text).toMatch(/^A moderator removed your avatar\. You can upload a new one after .+/);
        expect(notes[0].href).toBe("/account/view#avatar");
        expect((await player.page.locator("ul.forum-notes > li.unread .note-reason").innerText()).trim()).toBe(`Reason: ${REASON}`);
        await follow(player.page, player.page.locator("ul.forum-notes > li.unread a.note-text"));

        const strip = box(player).locator(".avatar-lock");
        expect(await strip.innerText()).toMatch(/^A forum moderator removed your avatar on .+\. You can upload a new one after .+\.\s+Reason: An advert in the picture\.$/);
        expect(await frame(player).count(), "no frame to click").toBe(0);
        expect((await box(player).locator(".avatar-letter").innerText()).trim()).toBe(name()[0]);
        expect((await side(player).innerText()).trim()).toBe("No avatar: the forum shows the first letter of your name beside your posts.");

        await openAccount(phone);
        await expectFits(phone, "account with the lock");
        await openNotifications(phone);
        await expectFits(phone, "notifications of the avatar");
        expectNoErrors([player, phone]);
    });

    it("lifts the ban: the user may upload again and is told so", async () => {
        await openSection(moderator, forumSeed().section);
        await openTopic(moderator, topic);
        await openAuthorPage(moderator, playerPost);
        await follow(moderator.page, modRow(moderator).locator("button.forum-lift-lock"));
        expect(await flash(moderator)).toBe("The upload ban is lifted.");
        expect((await modRow(moderator).locator(".state").innerText()).trim()).toBe("none");
        expect(await moderator.page.locator(".forum-user-log > li").first().innerText()).toContain("Avatar upload ban lifted");

        await openForum(player);
        const notes = (await openNotifications(player)).filter(n => n.unread);
        expect(notes.map(n => n.text)).toEqual(["A moderator lifted the ban: you can upload an avatar again"]);
        await readAllNotifications(player);
        await openAccount(player);
        expect(await box(player).locator(".avatar-lock").count()).toBe(0);
        expect((await frame(player).innerText()).trim()).toBe("+ Avatar");
        expectNoErrors([player, moderator]);
    });
});
