// The name of the Account page renamed in place (ui/html/pages/account.html, DESIGN.md, Editing):
// ✎ after the name opens the field, Enter or leaving it sends PUT /account/name
// (internal/webapp/user_names.go), Esc keeps the name. A refusal stays in the field with its error
// under it. ▾ after the name opens the former names, as the server answers them.
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";

export interface FormerName {
    name: string;
    /** Worded by the server in the viewer's language and time zone. */
    date: string;
}

interface Renamed {
    name: string;
    initial: string;
    former: FormerName[];
}

/** PUT /account/name: the stored name, or an Error with the text to show under the field. */
async function renameRequest(name: string, csrf: string): Promise<Renamed> {
    let res: Response;
    try {
        res = await fetch("/account/name", {
            method: "PUT",
            body: JSON.stringify({ name }),
            headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        });
    } catch {
        throw new Error(t("account.name.errors.offline"));
    }
    // 422 and 429 carry the error of the field, worded by the server.
    const answer = await res.json().catch(() => null) as (Partial<Renamed> & { errors?: { name?: string } }) | null;
    if (!res.ok || !answer) {
        throw new Error(answer?.errors?.name ?? t("account.name.errors.refused", { status: res.status }));
    }
    return { name: answer.name ?? name, initial: answer.initial ?? "", former: answer.former ?? [] };
}

export interface NameRowProps {
    name: string;
    former: FormerName[];
    csrf: string;
    /** After a rename, with the first letter of the new name. */
    onRenamed?: (initial: string) => void;
}

/** What the script draws in the name cell in place of the server's. */
export function NameRow(props: NameRowProps) {
    const [name, setName] = useState(props.name);
    const [former, setFormer] = useState(props.former);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const field = useRef<HTMLInputElement>(null);
    // Chrome blurs a focused field as it is taken out: Esc must not save.
    const cancelled = useRef(false);
    const busy = useRef(false);
    // Enter blurs the field to save; a refusal gives the focus back for the fix.
    const byEnter = useRef(false);
    // A refused name is not sent again by leaving the field once more.
    const refused = useRef<string | null>(null);
    useEffect(() => {
        cancelled.current = false;
        if (editing) field.current?.select();
    }, [editing]);

    const save = async (value: string) => {
        const refocus = byEnter.current;
        byEnter.current = false;
        if (cancelled.current || busy.current) return;
        if (value.trim() === name) {
            setEditing(false);
            setError(null);
            return;
        }
        if (value === refused.current) return;
        busy.current = true;
        setSaving(true);
        try {
            const renamed = await renameRequest(value, props.csrf);
            refused.current = null;
            setName(renamed.name);
            setFormer(renamed.former);
            setError(null);
            setEditing(false);
            props.onRenamed?.(renamed.initial);
        } catch (e) {
            refused.current = value;
            setError((e as Error).message);
            if (refocus) field.current?.focus();
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };
    const cancel = () => {
        cancelled.current = true;
        refused.current = null;
        setError(null);
        setEditing(false);
    };

    return (
        <>
            {editing ? (
                <input type="text" class="account-name-input" ref={field} defaultValue={name} readOnly={saving}
                    aria-label={t("account.name.field")} aria-invalid={error ? "true" : undefined}
                    aria-describedby={error ? "account-name-error" : undefined}
                    onBlur={e => save(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") {
                            byEnter.current = true;
                            e.currentTarget.blur();
                        }
                        if (e.key === "Escape") cancel();
                    }} />
            ) : (
                <>
                    <span class="account-name">{name}</span>
                    {former.length > 0 && <FormerNames former={former} />}
                    <button type="button" class="account-rename" title={t("common.rename")} aria-label={t("account.name.rename")}
                        onClick={() => setEditing(true)}>✎</button>
                </>
            )}
            {error && <p class="account-name-error" id="account-name-error">{error}</p>}
        </>
    );
}

/**
 * ▾ after the name and the panel of the former names under it: a <details>, as the server draws it
 * without the script (ui/html/pages/account.html, main.css). A click elsewhere or Esc closes it.
 */
function FormerNames({ former }: { former: FormerName[] }) {
    const details = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            const el = details.current;
            if (el?.open && !el.contains(e.target as Node)) el.open = false;
        };
        const onKey = (e: KeyboardEvent) => {
            const el = details.current;
            if (e.key !== "Escape" || !el?.open) return;
            el.open = false;
            el.querySelector("summary")?.focus();
        };
        document.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("click", onClick);
            document.removeEventListener("keydown", onKey);
        };
    }, []);
    const title = t("account.name.former");
    return (
        <details class="former-names" ref={details}>
            <summary class="former-names-toggle" title={title} aria-label={title}>▾</summary>
            <div class="former-names-panel">
                <div class="former-names-title">{title}</div>
                <ol>
                    {former.map(f => <li><span class="former-name">{f.name}</span><span class="former-date">{f.date}</span></li>)}
                </ol>
            </div>
        </details>
    );
}
