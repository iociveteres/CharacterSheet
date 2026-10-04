// How the bestiary page and the room write what the bestiary sends.
import type { Quota } from "./types.gen";

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** "Used 180 KB of 5 MB". */
export const quotaText = ({ used, limit }: Quota) => `Used ${formatBytes(used)} of ${formatBytes(limit)}`;

/** "BC" for "Black Crusade": a table has no room for the whole name. */
export const kindInitials = (label: string) => label.split(/\s+/).map(w => w[0]).join("").toUpperCase();
