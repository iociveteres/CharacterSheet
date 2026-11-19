export function App({ n, el }: { n: number; el: HTMLElement }) {
    el.textContent = "Loading";
    el.setAttribute("aria-label", "Close dialog");
    el.className = "not a label";
    if (!confirm("Delete it?")) return null;
    return <div title="Tooltip text" aria-label={t("common.close")}>
        Hello world
        {n > 1 ? "Many" : "One"}
        <input placeholder={`Search ${n} rows`} />
        <span>{t("common.close")}</span>
        <span>× — 12</span>
        &nbsp;
        Pistol
    </div>;
}

export const options = [{ value: "pistol", label: "Pistol" }, { value: "x", label: t("common.close") }];
