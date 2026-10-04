// "From bestiary": copies of a creature as NPCs of the open encounter, each in
// a group of its own. The creatures are those of the collections in the
// gamemaster's bestiary list: their own and their subscriptions.
import { useState } from "preact/hooks";
import { addCreature, setFromBestiaryOpen } from "../actions";
import { bestiary, creatureFilter, pickedCreatures } from "../../bestiary/state";
import { filterCreatures } from "../../bestiary/actions";
import { sheetKinds } from "../../state";
import { kindInitials, quotaText } from "../../../bestiary/format";
import { sectionOf, type Section } from "../../../bestiary/sections";
import { closeOnOverlay, useEscape } from "../../components/overlay";

const MAX_COPIES = 20;

// The sections of the bestiary page's list.
const COLLECTION_GROUPS: { label: string; section: Section }[] = [
    { label: "My", section: "own" },
    { label: "Subscriptions", section: "subscribed" },
];

export function FromBestiary() {
    const [picked, setPicked] = useState<number | null>(null);
    const [count, setCount] = useState(1);
    const close = () => setFromBestiaryOpen(false);
    useEscape(close);
    const filter = creatureFilter.value;
    const data = bestiary.value;
    const list = pickedCreatures.value;
    const kindLabel = (kind: string) => sheetKinds.find(k => k.kind === kind)?.label ?? kind;
    const chosen = list?.some(c => c.id === picked) ? picked : null;
    const collections = data?.collections ?? [];
    // Another user's creature names its owner.
    const ownerOf = (collectionId: number) => collections.find(c => c.id === collectionId && !c.own)?.owner;
    return (
        <div class="overlay open" onClick={closeOnOverlay(close)}>
            <div class="modal layout-column encounter-from-bestiary-modal" role="dialog" aria-modal="true" aria-label="From bestiary">
                <h3>From bestiary</h3>
                <div class="layout-row encounter-picker">
                    <select value={filter.collection ?? ""} aria-label="Collection"
                        onChange={e => filterCreatures({ collection: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
                        <option value="">All collections</option>
                        {COLLECTION_GROUPS.map(g => {
                            const group = collections.filter(c => sectionOf(c) === g.section);
                            return group.length > 0 && (
                                <optgroup key={g.label} label={g.label}>
                                    {group.map(c => <option key={c.id} value={c.id}>{c.own ? c.name : `${c.name} · ${c.owner}`}</option>)}
                                </optgroup>
                            );
                        })}
                    </select>
                    <select value={filter.tag} aria-label="Tag" onChange={e => filterCreatures({ tag: e.currentTarget.value })}>
                        <option value="">Any tag</option>
                        {data?.tags.creatures.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <input type="search" class="encounter-creature-search" placeholder="Search creatures" aria-label="Search creatures"
                    value={filter.q} onInput={e => filterCreatures({ q: e.currentTarget.value })} />
                <div class="encounter-sheet-list encounter-creature-list" role="listbox" aria-label="Creatures">
                    {list === null && <p class="encounter-muted">…</p>}
                    {list?.length === 0 && (
                        <p class="encounter-muted">{data?.collections.length === 0 ? "The bestiary is empty: save NPCs or sheets to a collection." : "No creature matches."}</p>
                    )}
                    {list?.map(c => (
                        <div key={c.id} role="option" aria-selected={c.id === chosen} data-creature-id={c.id}
                            class={c.id === chosen ? "encounter-creature selected" : "encounter-creature"}
                            onClick={() => setPicked(c.id)} onDblClick={() => addCreature(c.id, count)}>
                            <span class="encounter-creature-name">
                                {c.name}
                                {ownerOf(c.collectionId) && <span class="encounter-muted encounter-creature-owner"> · {ownerOf(c.collectionId)}</span>}
                            </span>
                            <span class="encounter-muted" title={kindLabel(c.kind)}>{kindInitials(kindLabel(c.kind))}</span>
                            <span class="encounter-muted encounter-creature-tags">{c.tags.join(", ")}</span>
                        </div>
                    ))}
                </div>
                <div class="actions">
                    {data && <span class="encounter-muted encounter-quota">{quotaText(data.quota)}</span>}
                    <label class="layout-row">
                        ×
                        <input type="number" class="encounter-creature-count" min={1} max={MAX_COPIES} value={count} aria-label="Copies"
                            onInput={e => setCount(Math.max(1, Math.min(MAX_COPIES, Number(e.currentTarget.value) || 1)))} />
                    </label>
                    <button type="button" class="button-colored" onClick={close}>Cancel</button>
                    <button type="button" class="button-colored encounter-add-creature" disabled={chosen === null}
                        onClick={() => chosen !== null && addCreature(chosen, count)}>Add</button>
                </div>
            </div>
        </div>
    );
}
