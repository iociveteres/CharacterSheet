import { lang, t } from "../i18n";

// Genitive, as in "2 января": the layout of the server's humanDate for ru.
const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** An RFC 3339 date in the layout of humanDate in internal/templates; "" for no date. */
export function humanDate(date: string): string {
    const time = new Date(date);
    if (!date || isNaN(time.getTime())) {
        return "";
    }

    // The server's layout in the site's language, whatever the browser's.
    // h23: with hour12: false some browsers write midnight as 24.
    function formatWithTZ(timeZone: string): string {
        const ru = lang() === "ru";
        const options: Intl.DateTimeFormatOptions = {
            day: "2-digit",
            month: ru ? "numeric" : "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone,
        };
        const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(time);
        const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
        if (ru) {
            return `${Number(get("day"))} ${RU_MONTHS[Number(get("month")) - 1]} ${get("year")} в ${get("hour")}:${get("minute")}`;
        }
        return `${get("day")} ${get("month")} ${get("year")} at ${get("hour")}:${get("minute")}`;
    }

    try {
        return formatWithTZ(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
        return formatWithTZ("UTC");
    }
}

export function formatDateLabel(date: Date): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = date.toDateString();
    if (dateStr === today.toDateString()) return t("room.chat.today");
    if (dateStr === yesterday.toDateString()) return t("room.chat.yesterday");

    return date.toLocaleDateString(lang(), { month: "long", day: "numeric" });
}

export function formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}
