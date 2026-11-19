// How the bestiary page and the room write what the bestiary sends.
import type { Creature, Quota } from "./types.gen";
import { lang, t } from "../i18n";

function formatBytes(n: number): string {
    if (n < 1024) return t("bestiary.collection.bytes", { n });
    if (n < 1024 * 1024) return t("bestiary.collection.kilobytes", { n: Math.round(n / 1024) });
    // One decimal, none when it is 0; "1,5" in Russian.
    const mb = new Intl.NumberFormat(lang(), { maximumFractionDigits: 1, useGrouping: false }).format(n / 1024 / 1024);
    return t("bestiary.collection.megabytes", { n: mb });
}

/** "Used 180 KB of 10 MB". */
export const quotaText = ({ used, limit }: Quota) =>
    t("bestiary.collection.quota", { used: formatBytes(used), limit: formatBytes(limit) });

/** "by you", "by alex", or nothing once the author's account is gone. */
export const byline = ({ author, byYou }: Pick<Creature, "author" | "byYou">) =>
    byYou ? t("bestiary.collection.byYou") : author ? t("bestiary.collection.by", { name: author }) : "";

/** "BC" for "Black Crusade": a table has no room for the whole name. */
export const kindInitials = (label: string) => label.split(/\s+/).map(w => w[0]).join("").toUpperCase();
