// The account as a user reaches it: signing in by the form of the nav, and what the account
// scenarios set up on a server started with -dev (launch config web-dev).
import { expect } from "vitest";
import type { Browser } from "playwright-core";
import { config, seed } from "./config";
import { follow } from "./forum";
import { Player } from "./player";

/**
 * Gives every client of the server's rate limits its burst back (POST /dev/limits/reset): a run
 * soon after another, or after the seed's sign-ins, would meet the limits of the one before.
 */
export async function resetLimits(): Promise<void> {
    const res = await fetch(`${config.base}/dev/limits/reset`, { method: "POST" });
    expect(res.status, "the reset of the rate limits: is the server started with -dev?").toBe(204);
}

/** A guest in a fresh browser who signs in with `email` and the seed password by the login link of the nav. */
export async function signIn(browser: Browser, name: string, email: string): Promise<Player> {
    const p = await Player.create(browser, name, { auth: "" });
    // A refused sign-in is the login page again with 422: the caller tells it by onLoginPage.
    p.allowErrors(/status of 422/);
    await p.page.goto(`${p.base}/`);
    await follow(p.page, p.page.locator("nav.site-wide a[href='/user/login']"));
    await p.page.fill("input[name=email]", email);
    await p.page.fill("input[name=password]", seed().password);
    await follow(p.page, p.page.locator("form input[type=submit]"));
    return p;
}

/** Whether the open page is the login page, where the site sends a guest. */
export const onLoginPage = (p: Player) => new URL(p.page.url()).pathname.startsWith("/user/login");
