// How the bestiary page and the room write what the bestiary sends.
import type { Creature, Quota } from "./types.gen";

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** "Used 180 KB of 5 MB". */
export const quotaText = ({ used, limit }: Quota) => `Used ${formatBytes(used)} of ${formatBytes(limit)}`;

/** "by you", "by alex", or nothing once the author's account is gone. */
export const byline = ({ author, byYou }: Pick<Creature, "author" | "byYou">) =>
    byYou ? "by you" : author ? `by ${author}` : "";

/** "BC" for "Black Crusade": a table has no room for the whole name. */
export const kindInitials = (label: string) => label.split(/\s+/).map(w => w[0]).join("").toUpperCase();
