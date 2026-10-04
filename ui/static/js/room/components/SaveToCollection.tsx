// "Save to collection": a copy of a sheet of the room or of an NPC into a
// collection of the user's bestiary, an existing one or a new one.
import { useState } from "preact/hooks";
import { bestiary, savingSheet } from "../bestiary/state";
import { closeSaveToCollection, saveToCollection } from "../bestiary/actions";
import { quotaText } from "../../bestiary/format";
import { closeOnOverlay, useEscape } from "./overlay";

// The value of the option that names a new collection.
const NEW = "new";

export function SaveToCollection() {
    const sheet = savingSheet.value;
    return sheet ? <SaveDialog key={sheet.sheetId} name={sheet.name} /> : null;
}

function SaveDialog({ name }: { name: string }) {
    const data = bestiary.value;
    const [target, setTarget] = useState("");
    const [newName, setNewName] = useState("");
    useEscape(closeSaveToCollection);
    // The user's subscriptions are in the list too, but only their own collections take a sheet.
    const own = data?.collections.filter(c => c.own) ?? [];
    // The default collection until another is picked.
    const first = own.find(c => c.default) ?? own[0];
    const picked = target || (first ? String(first.id) : NEW);
    const ready = data !== null && (picked !== NEW || newName.trim() !== "");
    const save = () => {
        if (!ready) return;
        void saveToCollection(picked === NEW ? { newCollection: newName.trim() } : { collectionId: Number(picked) });
    };
    return (
        <div class="overlay open" onClick={closeOnOverlay(closeSaveToCollection)}>
            <div class="modal layout-column save-to-collection-modal" role="dialog" aria-modal="true" aria-label="Save to collection">
                <h3>Save "{name}" to a collection</h3>
                {data === null ? <p class="encounter-muted">…</p> : (
                    <select class="save-to-collection-target" value={picked} aria-label="Collection"
                        onChange={e => setTarget(e.currentTarget.value)}>
                        {own.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value={NEW}>New collection…</option>
                    </select>
                )}
                {picked === NEW && (
                    <input type="text" class="save-to-collection-name" placeholder="Name of the new collection" maxLength={100}
                        aria-label="Name of the new collection" value={newName}
                        onInput={e => setNewName(e.currentTarget.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") save();
                        }} />
                )}
                {data && <span class="encounter-muted save-to-collection-quota">{quotaText(data.quota)}</span>}
                <div class="actions">
                    <button type="button" class="button-colored" onClick={closeSaveToCollection}>Cancel</button>
                    <button type="button" class="button-colored save-to-collection-save" disabled={!ready} onClick={save}>Save</button>
                </div>
            </div>
        </div>
    );
}
