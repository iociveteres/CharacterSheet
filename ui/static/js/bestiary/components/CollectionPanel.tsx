// The middle panel: the selected collection, its creatures and the quota, or
// the catalog of public collections.
import { useRef, useState } from "preact/hooks";
import type { BestiaryCollection, Quota } from "../types.gen";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";
import { center, creatures, kindLabel, query, quota, selectedCollection, selectedCreatureId, sheetKinds } from "../state";
import {
    deleteCollection, newCreature, openDialog, selectCreature, setQuery, setVisibility, subscribe, unsubscribe, uploadFiles,
} from "../actions";
import { collectionExportUrl } from "../api";
import { kindInitials, quotaText } from "../format";
import { Catalog } from "./Catalog";
import { Menu, MenuItem, Tags } from "./common";

export function CollectionPanel() {
    const collection = selectedCollection.value;
    return (
        <section class="bestiary-panel bestiary-creatures" aria-label="Creatures">
            <div class="bestiary-panel-body">
                {center.value === "catalog"
                    ? <Catalog />
                    : collection
                        ? <Collection key={collection.id} collection={collection} />
                        : <p class="bestiary-muted">Pick or create a collection to keep creatures in.</p>}
            </div>
            <div class="bestiary-panel-footer">
                {quota.value && <QuotaLine quota={quota.value} />}
            </div>
        </section>
    );
}

function Collection({ collection }: { collection: BestiaryCollection }) {
    const { id, own } = collection;
    const files = useRef<HTMLInputElement>(null);
    // Another user's collection is read-only: its creatures are copied out one by one.
    return (
        <div class="bestiary-collection-view" data-collection-id={id} data-own={String(own)}>
            <div class="bestiary-header">
                <h2 class="bestiary-title">{collection.name}</h2>
                {own
                    ? <span class="bestiary-chip bestiary-visibility">{collection.visibility}</span>
                    : <span class="bestiary-muted bestiary-owner">by {collection.owner}</span>}
                <span class="bestiary-spacer" />
                {own
                    ? <Menu label="Collection menu" class="bestiary-collection-menu">
                        <MenuItem onClick={() => openDialog({ type: "collection", field: "name", id })}>Rename</MenuItem>
                        <MenuItem onClick={() => openDialog({ type: "collection", field: "description", id })}>Description</MenuItem>
                        <MenuItem onClick={() => openDialog({ type: "collection", field: "tags", id })}>Tags</MenuItem>
                        {/* The default collection is always private and never deleted. */}
                        {!collection.default && (collection.visibility === "private"
                            ? <MenuItem onClick={() => void setVisibility(id, "public")}>Make public…</MenuItem>
                            : <MenuItem onClick={() => void setVisibility(id, "private")}>Make private</MenuItem>)}
                        <a role="menuitem" class="bestiary-menu-item" href={collectionExportUrl(id)} download>Export</a>
                        {!collection.default && <MenuItem danger onClick={() => void deleteCollection(id)}>Delete</MenuItem>}
                    </Menu>
                    : <button type="button" class="bestiary-subscribe" aria-pressed={collection.subscribed}
                        onClick={() => void (collection.subscribed ? unsubscribe(id) : subscribe(id))}>
                        {collection.subscribed ? "Unsubscribe" : "Subscribe"}
                    </button>}
            </div>
            {collection.description && <p class="bestiary-description">{collection.description}</p>}
            <Tags tags={collection.tags} />
            <div class="bestiary-toolbar">
                <input type="search" class="bestiary-search" placeholder="Search creatures" aria-label="Search creatures"
                    value={query.value} onInput={e => setQuery(e.currentTarget.value)} />
                {own && <>
                    <NewCreature collectionId={id} />
                    <button type="button" class="bestiary-upload" title="Add creatures from exported sheets and collections"
                        onClick={() => files.current?.click()}>Upload</button>
                    <input type="file" ref={files} multiple accept=".json,application/json" hidden
                        onChange={e => {
                            const input = e.currentTarget;
                            void uploadFiles(id, [...(input.files ?? [])]);
                            // The same files again are a new upload.
                            input.value = "";
                        }} />
                </>}
            </div>
            <CreatureTable empty={query.value.trim()
                ? "No creature matches."
                : own ? "No creatures yet: make a new one, upload sheet files or save NPCs from a room." : "No creatures."} />
        </div>
    );
}

/** The kind of the new creature, when there is more than one, and the button that makes it. */
function NewCreature({ collectionId }: { collectionId: number }) {
    const [kind, setKind] = useState<SheetKind>(sheetKinds[0]?.kind ?? "black_crusade");
    return <>
        {sheetKinds.length > 1 && (
            <select class="bestiary-new-creature-kind" value={kind} aria-label="Kind of the new creature"
                onChange={e => setKind(e.currentTarget.value as SheetKind)}>
                {sheetKinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
        )}
        <button type="button" class="bestiary-new-creature" onClick={() => void newCreature(collectionId, kind)}>New creature</button>
    </>;
}

function CreatureTable({ empty }: { empty: string }) {
    const list = creatures.value;
    if (!list.length) return <p class="bestiary-muted">{empty}</p>;
    return (
        <table class="bestiary-table bestiary-creature-table">
            <thead>
                <tr><th>Name</th><th>Kind</th><th>Tags</th></tr>
            </thead>
            <tbody>
                {list.map(c => (
                    <tr key={c.id} data-creature-id={c.id} tabIndex={0} aria-selected={c.id === selectedCreatureId.value}
                        class={c.id === selectedCreatureId.value ? "selected" : undefined}
                        onClick={() => selectCreature(c.id)}
                        onKeyDown={e => {
                            if (e.key === "Enter") selectCreature(c.id);
                        }}>
                        <td class="bestiary-creature-name">{c.name}</td>
                        <td><span class="bestiary-chip" title={kindLabel(c.kind)}>{kindInitials(kindLabel(c.kind))}</span></td>
                        <td class="bestiary-muted">{c.tags.join(", ")}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function QuotaLine({ quota }: { quota: Quota }) {
    return (
        <span class="bestiary-muted bestiary-quota" title="NPCs in encounters and creatures in collections">
            {quotaText(quota)}
        </span>
    );
}
