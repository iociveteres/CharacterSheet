// Where the scenarios run. Every value can be overridden by an E2E_* variable.
const env = (name: string, fallback: string) => process.env[name] || fallback;

export const config = {
    /** The build under test, started with BASE_URL set to it (launch config web-local or web-dev). */
    base: env("E2E_BASE", "http://localhost:4002"),
    /** The old build on the same database (cs-baseline.exe) for the comparison scenarios. */
    oldBase: env("E2E_OLD_BASE", "http://localhost:4001"),
    /** Session saved by `node scripts/perf/sheet-render.mjs login --base <base>`. */
    auth: env("E2E_AUTH", "scripts/perf/.auth.json"),
    /** Session of a room member who cannot edit the owner's sheets, for scenario 16 on a fresh sheet. */
    viewerAuth: process.env.E2E_VIEWER_AUTH ?? "",
    /** Without viewerAuth, scenario 16 reads this "room:sheet" that the signed-in user cannot edit. */
    readOnlySheet: env("E2E_READONLY_SHEET", "2:51").split(":").map(Number) as [number, number],
    /** Room where test sheets are created and deleted. */
    room: Number(env("E2E_ROOM", "5")),
    /** Room with the filled sheets the comparison scenarios read. */
    fullRoom: Number(env("E2E_FULL_ROOM", "2")),
    fullSheets: env("E2E_FULL_SHEETS", "59,51").split(",").map(Number),
    /** Shows the browser; drags need it only if the headless run misbehaves. */
    headed: !!process.env.E2E_HEADED,
};

/** Whether a server answers at `base`. */
export async function isUp(base: string): Promise<boolean> {
    try {
        const res = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch {
        return false;
    }
}
