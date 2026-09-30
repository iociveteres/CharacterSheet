// Where the scenarios run. Every value can be overridden by an E2E_* variable.
import { existsSync, readFileSync } from "node:fs";

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const config = {
    /** The build under test, started with BASE_URL set to it (launch config web-local or web-dev). */
    base: env("E2E_BASE", "http://localhost:4002"),
    /** The old build on the same database (cs-baseline.exe) for the comparison scenarios. */
    oldBase: env("E2E_OLD_BASE", "http://localhost:4001"),
    /** Session saved by `node scripts/perf/sheet-render.mjs login --base <base>`. */
    auth: env("E2E_AUTH", "scripts/perf/.auth.json"),
    /** Session of a room member who cannot edit the owner's sheets, for sync/read-only.e2e.ts on a fresh sheet. */
    viewerAuth: process.env.E2E_VIEWER_AUTH ?? "",
    /** Without viewerAuth, sync/read-only.e2e.ts reads this "room:sheet" that the signed-in user cannot edit. */
    readOnlySheet: env("E2E_READONLY_SHEET", "2:51").split(":").map(Number) as [number, number],
    /** Room where test sheets are created and deleted. */
    room: Number(env("E2E_ROOM", "5")),
    /** Room with the filled sheets the comparison scenarios read. */
    fullRoom: Number(env("E2E_FULL_ROOM", "2")),
    fullSheets: env("E2E_FULL_SHEETS", "59,51").split(",").map(Number),
    /** Shows the browser; drags need it only if the headless run misbehaves. */
    headed: !!process.env.E2E_HEADED,
};

/** A role of the seeded room: its users by key (cmd/seedtest). */
export type SeedRole = "gm" | "moderator" | "player" | "player2" | "outsider";

export interface SeedUser {
    key: SeedRole;
    name: string;
    id: number;
    /** Empty for the outsider, who is not in the room. */
    role: string;
    /** The user's own sheet in the room; none for the moderator and the outsider. */
    sheetId?: number;
    /** The saved session of the user. */
    auth: string;
}

export interface Seed {
    base: string;
    roomId: number;
    users: SeedUser[];
}

const SEED_FILE = env("E2E_SEED", "scripts/perf/.seed.json");
let seeded: Seed | null = null;

/**
 * The seeded room and the sessions of its roles, written by `npm run seed`.
 * Scenarios with roles run on it; the others keep E2E_AUTH and E2E_ROOM.
 */
export function seed(): Seed {
    if (!seeded) {
        if (!existsSync(SEED_FILE)) throw new Error(`No ${SEED_FILE}: run "npm run seed" against ${config.base} first`);
        seeded = JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed;
    }
    return seeded;
}

/** The seeded user of `role`. */
export function seedUser(role: SeedRole): SeedUser {
    const user = seed().users.find(u => u.key === role);
    if (!user) throw new Error(`No user "${role}" in ${SEED_FILE}: run "npm run seed" again`);
    return user;
}

/** Whether a server answers at `base`. */
export async function isUp(base: string): Promise<boolean> {
    try {
        const res = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch {
        return false;
    }
}
