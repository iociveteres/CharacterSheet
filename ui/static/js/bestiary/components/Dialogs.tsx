// The modals of the page: one per Dialog of the state, and the confirm.
import { useEffect, useRef, useState } from "preact/hooks";
import { confirmMessage, creatures, dialog, ownCollections, type Dialog } from "../state";
import { answerConfirm, closeDialog, copyCreature, createCollection, moveCreature } from "../actions";
import { Modal } from "./common";

export function Dialogs() {
    const open = dialog.value;
    const question = confirmMessage.value;
    return (
        <>
            {open && <DialogOf key={JSON.stringify(open)} open={open} />}
            {question !== null && <Confirm message={question} />}
        </>
    );
}

function DialogOf({ open }: { open: Dialog }) {
    switch (open.type) {
        case "newCollection":
            return <TextDialog label="New collection" initial="" maxLength={100} submit={name => createCollection(name)} />;
        case "copy":
        case "move":
            return <PickCollection open={open} />;
    }
}

function Actions({ ok, disabled, onOk }: { ok: string; disabled?: boolean; onOk: () => void }) {
    return (
        <div class="actions">
            <button type="button" onClick={closeDialog}>Cancel</button>
            <button type="button" class="bestiary-dialog-ok" disabled={disabled} onClick={onOk}>{ok}</button>
        </div>
    );
}

function TextDialog({ label, initial, maxLength, submit }: {
    label: string;
    initial: string;
    maxLength: number;
    submit: (value: string) => void;
}) {
    const [value, setValue] = useState(initial);
    // autofocus works only for what is in the page when it loads.
    const field = useRef<HTMLInputElement>(null);
    useEffect(() => field.current?.focus(), []);
    const ok = value.trim() !== "";
    const save = () => {
        if (ok) submit(value.trim());
    };
    return (
        <Modal label={label} onClose={closeDialog}>
            <input type="text" class="bestiary-dialog-text" maxLength={maxLength} value={value} ref={field}
                onInput={e => setValue(e.currentTarget.value)}
                onKeyDown={e => {
                    if (e.key === "Enter") save();
                }} />
            <Actions ok="Save" disabled={!ok} onOk={save} />
        </Modal>
    );
}

// The target of a copy that names a new collection.
const NEW = 0;

/**
 * "Copy to…", "Copy to my collection…" and "Move to…": a collection of the
 * user, the default one picked at first; a copy may go into the same one or
 * a new one.
 */
function PickCollection({ open }: { open: Dialog & { type: "copy" | "move" } }) {
    const creature = creatures.value.find(c => c.id === open.id);
    const move = open.type === "move";
    const targets = ownCollections.value.filter(c => !move || c.id !== creature?.collectionId);
    const [target, setTarget] = useState((targets.find(c => c.default) ?? targets[0])?.id ?? NEW);
    const [newName, setNewName] = useState("");
    if (!creature) return null;
    const ok = move ? targets.length > 0 : target !== NEW || newName.trim() !== "";
    const submit = () => {
        if (!ok) return;
        if (move) void moveCreature(open.id, target);
        else void copyCreature(open.id, target === NEW ? { newCollection: newName.trim() } : { collectionId: target });
    };
    return (
        <Modal label={`${move ? "Move" : "Copy"} "${creature.name}" to`} onClose={closeDialog}>
            {move && !targets.length
                ? <p class="bestiary-muted">There is no other collection.</p>
                : <select class="bestiary-dialog-target" value={target} aria-label="Collection"
                    onChange={e => setTarget(Number(e.currentTarget.value))}>
                    {targets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    {!move && <option value={NEW}>New collection…</option>}
                </select>}
            {!move && target === NEW && (
                <input type="text" class="bestiary-dialog-text bestiary-new-collection-name" placeholder="Name of the new collection"
                    aria-label="Name of the new collection" maxLength={100} value={newName}
                    onInput={e => setNewName(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") submit();
                    }} />
            )}
            <Actions ok={move ? "Move" : "Copy"} disabled={!ok} onOk={submit} />
        </Modal>
    );
}

function Confirm({ message }: { message: string }) {
    // Wherever the focus is, Enter answers yes; Esc no, as the overlay does.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            answerConfirm(true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    return (
        <Modal label="Confirm" onClose={() => answerConfirm(false)}>
            <div class="confirm-text">{message}</div>
            <div class="actions">
                <button type="button" onClick={() => answerConfirm(false)}>Cancel</button>
                <button type="button" class="bestiary-confirm-ok" onClick={() => answerConfirm(true)}>OK</button>
            </div>
        </Modal>
    );
}
