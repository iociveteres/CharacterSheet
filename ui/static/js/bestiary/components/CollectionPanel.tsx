// The middle panel: the selected collection, its creatures and the quota, or
// the catalog of public collections.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { BestiaryCollection, Quota } from "../types.gen";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";
import { center, creatures, kindLabel, query, quota, selectedCollection, selectedCreatureId, sheetKinds } from "../state";
import {
    deleteCollection, deleteCreature, editCollection, newCreature, openDialog, selectCreature, setQuery, setVisibility,
    subscribe, unsubscribe, uploadFiles,
} from "../actions";
import { collectionExportUrl, creatureExportUrl } from "../api";
import { byline, kindInitials, quotaText } from "../format";
import { Catalog } from "./Catalog";
import { InlineName, Menu, MenuItem, useEscape } from "./common";
import { useClickOutside } from "../../room/components/useClickOutside";

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
                {own
                    ? <InlineName name={collection.name} what="collection" maxLength={100} save={name => void editCollection(id, { name })}>
                        <h2 class="bestiary-title">{collection.name}</h2>
                    </InlineName>
                    : <h2 class="bestiary-title">{collection.name}</h2>}
                {own
                    ? <span class="bestiary-chip bestiary-visibility">{collection.visibility}</span>
                    : <span class="bestiary-muted bestiary-owner">by {collection.owner}</span>}
                <span class="bestiary-spacer" />
                {own
                    ? <div class="bestiary-collection-actions">
                        {/* The default collection is always private and never deleted. */}
                        {!collection.default && (collection.visibility === "private"
                            ? <button type="button" class="button-linklike bestiary-action" onClick={() => void setVisibility(id, "public")}>Make public…</button>
                            : <button type="button" class="button-linklike bestiary-action" onClick={() => void setVisibility(id, "private")}>Make private</button>)}
                        <a class="bestiary-action bestiary-collection-export" href={collectionExportUrl(id)} download>Export</a>
                        {!collection.default && (
                            <button type="button" class="button-linklike bestiary-action danger" onClick={() => void deleteCollection(id)}>Delete</button>
                        )}
                    </div>
                    : <button type="button" class="bestiary-subscribe" aria-pressed={collection.subscribed}
                        onClick={() => void (collection.subscribed ? unsubscribe(id) : subscribe(id))}>
                        {collection.subscribed ? "Unsubscribe" : "Subscribe"}
                    </button>}
            </div>
            <Description collection={collection} />
            <div class="bestiary-toolbar">
                <input type="search" class="bestiary-search" placeholder="Search creatures" aria-label="Search creatures"
                    value={query.value} onInput={e => setQuery(e.currentTarget.value)} />
                {own && <>
                    <NewCreature collectionId={id} />
                    {/* ↑ as the room's import of a character. */}
                    <button type="button" class="bestiary-upload" title="Add creatures from exported sheets and collections"
                        aria-label="Upload" onClick={() => files.current?.click()}>↑</button>
                    <input type="file" ref={files} multiple accept=".json,application/json" hidden
                        onChange={e => {
                            const input = e.currentTarget;
                            void uploadFiles(id, [...(input.files ?? [])]);
                            // The same files again are a new upload.
                            input.value = "";
                        }} />
                </>}
            </div>
            <CreatureTable own={own} empty={query.value.trim()
                ? "No creature matches."
                : own ? "No creatures yet: make a new one, upload sheet files or save NPCs from a room." : "No creatures."} />
        </div>
    );
}

/**
 * The description under the header: one line of it, the whole in a card over
 * the creatures, so that opening it moves nothing. The user edits their own's
 * in the card: leaving the field saves it, Esc keeps the old one.
 */
function Description({ collection }: { collection: BestiaryCollection }) {
    const { id, own, description } = collection;
    const [card, setCard] = useState<"closed" | "read" | "edit">("closed");
    const [clipped, setClipped] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    const line = useRef<HTMLParagraphElement>(null);
    // Chrome blurs a focused field as it is taken out: Esc must not save.
    const cancelled = useRef(false);
    useClickOutside(box, card !== "closed", () => setCard("closed"));
    useEscape(() => {
        cancelled.current = true;
        setCard("closed");
    });
    useLayoutEffect(() => {
        const el = line.current;
        if (!el) return;
        // Only a description the line cuts opens; the width changes with the window.
        const measure = () => setClipped(el.scrollWidth > el.clientWidth || description.includes("\n"));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [description]);

    if (!description && !own) return null;
    const edit = () => {
        cancelled.current = false;
        setCard("edit");
    };
    const toggle = () => setCard(card === "closed" ? "read" : "closed");
    return (
        <div class="bestiary-description-box" ref={box}>
            <div class="bestiary-description-row">
                {description
                    ? <p ref={line} class="bestiary-description"
                        role={clipped ? "button" : undefined} tabIndex={clipped ? 0 : undefined} aria-expanded={clipped ? card !== "closed" : undefined}
                        onClick={() => clipped && toggle()}
                        onKeyDown={e => {
                            if (clipped && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                toggle();
                            }
                        }}>{description}</p>
                    : <button type="button" class="button-linklike bestiary-add-description" onClick={edit}>Add a description…</button>}
                {own && description && (
                    <button type="button" class="button-linklike bestiary-rename" title="Edit the description" aria-label="Edit the description"
                        onClick={edit}>✎</button>
                )}
            </div>
            {card !== "closed" && (
                <div class="bestiary-description-card">
                    {card === "edit"
                        ? <textarea class="bestiary-description-field" aria-label="Description of the collection" maxLength={2000} rows={8}
                            placeholder="What the collection is for, where its creatures come from." defaultValue={description}
                            ref={el => el?.focus()}
                            onBlur={e => {
                                setCard("closed");
                                if (!cancelled.current && e.currentTarget.value !== description) void editCollection(id, { description: e.currentTarget.value });
                            }} />
                        : <p class="bestiary-description-full">{description}</p>}
                </div>
            )}
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

/** The creatures of the collection, what is done to one in its row's ⋯; a creature is renamed in its sheet. */
function CreatureTable({ own, empty }: { own: boolean; empty: string }) {
    const list = creatures.value;
    if (!list.length) return <p class="bestiary-muted">{empty}</p>;
    return (
        <table class="bestiary-table bestiary-creature-table">
            <thead>
                <tr><th>Name</th><th>Kind</th><th /></tr>
            </thead>
            <tbody>
                {list.map(c => (
                    <tr key={c.id} data-creature-id={c.id} tabIndex={0} aria-selected={c.id === selectedCreatureId.value}
                        class={c.id === selectedCreatureId.value ? "selected" : undefined}
                        onClick={() => selectCreature(c.id)}
                        onKeyDown={e => {
                            if (e.key === "Enter") selectCreature(c.id);
                        }}>
                        <td>
                            <div class="bestiary-creature-name">{c.name}</div>
                            {/* Empty once the author is gone, still a line: the rows are of one height. */}
                            <div class="bestiary-muted bestiary-creature-author">{byline(c)}</div>
                        </td>
                        <td><span class="bestiary-chip" title={kindLabel(c.kind)}>{kindInitials(kindLabel(c.kind))}</span></td>
                        <td class="bestiary-row-menu">
                            <Menu label="Creature menu" class="bestiary-creature-menu">
                                {own
                                    ? <>
                                        <MenuItem onClick={() => openDialog({ type: "copy", id: c.id })}>Copy to…</MenuItem>
                                        <MenuItem onClick={() => openDialog({ type: "move", id: c.id })}>Move to…</MenuItem>
                                    </>
                                    : <MenuItem onClick={() => openDialog({ type: "copy", id: c.id })}>Copy to my collection…</MenuItem>}
                                <a role="menuitem" class="bestiary-menu-item" href={creatureExportUrl(c.id)} download>Export</a>
                                {own && <MenuItem danger onClick={() => void deleteCreature(c.id)}>Delete</MenuItem>}
                            </Menu>
                        </td>
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
