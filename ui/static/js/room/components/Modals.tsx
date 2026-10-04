// The overlay and the modals of the room. The overlay stays in the page, so
// room.css fades it in and out with .open.
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { confirmMessage, inviteLink, me, modals } from "../state";
import { answerConfirm, closeModal, createInviteLink, importSheet } from "../actions";
import { isElevated } from "../permissions";
import { SaveToCollection } from "./SaveToCollection";
import { AddVariant } from "./AddVariant";

function closeOnEscape(e: KeyboardEvent): void {
    if (e.key === "Escape") closeModal();
}

function leaveRoom(): void {
    window.location.href = `${window.location.origin}/account/rooms`;
}

function reloadPage(): void {
    window.location.reload();
}

export function Modals() {
    const open = modals.value;
    const question = confirmMessage.value;
    const anyOpen = open.invite || open.import || open.kicked || open.connectionLost || question !== null;

    // Wherever the focus is, Esc answers the confirm no and Enter yes. The
    // listener stays for the page: one added with the confirm would miss a key
    // pressed before the effect runs.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (confirmMessage.value === null) return;
            if (e.key === "Escape") {
                answerConfirm(false);
            } else if (e.key === "Enter") {
                e.preventDefault();
                answerConfirm(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const onOverlayClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (open.kicked) leaveRoom();
        else if (open.connectionLost) reloadPage();
        else closeModal();
    };

    return (
        <>
            <div id="overlay" class={anyOpen ? "overlay open" : "overlay"} onClick={onOverlayClick}
                aria-hidden={anyOpen ? undefined : "true"} tabIndex={-1}>
                {question !== null && <ConfirmModal message={question} />}
                {open.invite && isElevated(me.value.role) && <InviteModal />}
                {open.import && <ImportModal />}
                {open.kicked && (
                    <div id="kicked-modal" class="modal layout-column" role="dialog" aria-modal="true">
                        <div>You have been kicked from the room<br />:(</div>
                        <div class="actions">
                            <button onClick={leaveRoom} class="button-colored" title="Close">OK</button>
                        </div>
                    </div>
                )}
                {open.connectionLost && (
                    <div id="connection-lost-modal" class="modal layout-column" role="dialog" aria-modal="true">
                        <div>Connection to server lost.<br />Please refresh the page.</div>
                        <div class="actions">
                            <button onClick={reloadPage} class="button-colored" title="Refresh">Refresh</button>
                        </div>
                    </div>
                )}
            </div>
            {/* Over the encounter window too, with an overlay of its own. */}
            <SaveToCollection />
            <AddVariant />
        </>
    );
}

function ConfirmModal({ message }: { message: string }) {
    return (
        <div id="confirm-modal" class="modal layout-column" role="dialog" aria-modal="true">
            <div class="confirm-text">{message}</div>
            <div class="actions">
                <button onClick={() => answerConfirm(false)} class="button-colored" type="button" title="Cancel">Cancel</button>
                <button onClick={() => answerConfirm(true)} class="button-colored" type="button" title="Confirm">OK</button>
            </div>
        </div>
    );
}

const COPIED_MS = 1400;

function InviteModal() {
    const copyButton = useRef<HTMLButtonElement>(null);
    const [copied, setCopied] = useState(false);
    const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
    const [maxUses, setMaxUses] = useState<number | null>(null);

    useEffect(() => copyButton.current?.focus(), []);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink.value);
            setCopied(true);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    return (
        <div id="invite-link-modal" class="modal layout-column" role="dialog" aria-modal="true" onKeyDown={closeOnEscape}>
            <div>
                <div>Active invite link</div>
                <div class="layout-row">
                    <input id="active-invite-link" type="text" readonly aria-label="Invite link" value={inviteLink.value} />
                    <button ref={copyButton} onClick={copy} class={copied ? "button-colored copied" : "button-colored"}
                        title="Copy invite link">
                        {copied ? "Copied!" : "Copy"}
                    </button>
                </div>
            </div>

            <div id="new-link-options">
                Or create new one
                <div>
                    <div>
                        <label for="invite-expires">Expires in:</label>
                        <select id="invite-expires" value={String(expiresInDays)}
                            onChange={e => {
                                const value = e.currentTarget.value;
                                setExpiresInDays(value === "null" ? null : Number(value));
                            }}>
                            <option value="1">1 day</option>
                            <option value="7">7 days</option>
                            <option value="30">30 days</option>
                            <option value="null">Unlimited</option>
                        </select>
                    </div>

                    <div>
                        <label class="label" for="max-uses">Max uses (0 for unlimited):</label>
                        <input id="max-uses" name="max-uses" class="text" type="number" placeholder="0" min="0" max="1000"
                            value={maxUses ?? ""}
                            onInput={e => {
                                const value = e.currentTarget.value;
                                setMaxUses(value === "" ? null : Number(value));
                            }} />
                    </div>
                </div>
            </div>

            <div class="actions">
                <button onClick={closeModal} class="button-colored" title="Close">Cancel</button>
                <button onClick={() => createInviteLink(expiresInDays, maxUses || null)} class="button-colored"
                    title="Create new invite link">Create</button>
            </div>
        </div>
    );
}

function ImportModal() {
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => fileInput.current?.focus(), []);

    return (
        <div id="import-modal" class="modal layout-column" role="dialog" aria-modal="true" onKeyDown={closeOnEscape}>
            <h3>Import Character</h3>
            <form enctype="multipart/form-data">
                <div class="layout-column">
                    <label for="sheet-file">Select JSON file:</label>
                    <input ref={fileInput} type="file" id="sheet-file" name="sheet_file" accept=".json" required />
                </div>
            </form>

            <div class="actions">
                <button onClick={closeModal} class="button-colored" title="Close">Cancel</button>
                <button onClick={() => importSheet(fileInput.current?.files?.[0])} class="button-colored"
                    title="Import character">Import</button>
            </div>
        </div>
    );
}
