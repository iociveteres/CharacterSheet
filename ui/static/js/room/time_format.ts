/** An RFC 3339 date in the layout of humanDate in internal/templates; "" for no date. */
export function humanDate(date: string): string {
    const t = new Date(date);
    if (!date || isNaN(t.getTime())) {
        return "";
    }

    // The server's layout, whatever the browser's language. h23: with
    // hour12: false some browsers write midnight as 24.
    function formatWithTZ(timeZone: string): string {
        const options: Intl.DateTimeFormatOptions = {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone,
        };
        const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(t);
        const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
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
    if (dateStr === today.toDateString()) return "Today";
    if (dateStr === yesterday.toDateString()) return "Yesterday";

    return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}
