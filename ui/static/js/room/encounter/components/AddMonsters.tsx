// "Add monsters", the tab over the first two columns of the encounter window:
// the collections of the gamemaster's bestiary list, their own and their
// subscriptions, and the creatures of the one picked, each with its button
// that adds a copy to the Enemies; an own collection makes new ones, as on
// the bestiary page. A creature picked is previewed in the fourth column.
import { useRef, useState } from "preact/hooks";
import type { Creature } from "../../../bestiary/types.gen";
import { addCreature, newCreature, previewCreature, setEncounterTab } from "../actions";
import { encounterTab, pickedForPreview, sheetOf } from "../state";
import { bestiary, creatureFilter, pickedCreatures, pickerReading } from "../../bestiary/state";
import { filterCreatures } from "../../bestiary/actions";
import { sheetKinds } from "../../state";
import { byline, kindInitials, quotaText } from "../../../bestiary/format";
import { sectionOf } from "../../../bestiary/sections";
import { renderStatBlockView } from "../../../sheet/view";
import { useSheetView } from "../../../sheet/useSheetView";
import type { SheetInstance } from "../../../sheet/instance";
import type { SheetKind } from "../../../sheet/kinds/kinds.gen";

const TABS = [{ tab: "combat", label: "Combat" }, { tab: "monsters", label: "Add monsters" }] as const;

export function EncounterTabs() {
    return (
        <div class="encounter-tabs" role="tablist">
            {TABS.map(({ tab, label }) => (
                <button key={tab} type="button" role="tab" class="encounter-tab" data-tab={tab}
                    aria-selected={encounterTab.value === tab} onClick={() => setEncounterTab(tab)}>{label}</button>
            ))}
        </div>
    );
}

/** Another user's collection names its owner. */
const collectionLabel = (c: { name: string; own: boolean; owner: string }) => c.own ? c.name : `${c.name} · ${c.owner}`;

function CollectionItem({ id, label }: { id: number | null; label: string }) {
    const picked = creatureFilter.value.collection === id;
    return (
        <div role="option" aria-selected={picked} class={picked ? "encounter-collection selected" : "encounter-collection"}
            data-collection-id={id ?? "all"} onClick={() => filterCreatures({ collection: id })}>{label}</div>
    );
}

export function CollectionsColumn() {
    const data = bestiary.value;
    const own = data?.collections.filter(c => sectionOf(c) === "own") ?? [];
    const subscribed = data?.collections.filter(c => sectionOf(c) === "subscribed") ?? [];
    return (
        <div class="encounter-column" data-column="collections">
            <div class="encounter-column-body" role="listbox" aria-label="Collections" aria-busy={pickerReading.value}>
                <CollectionItem id={null} label="All collections" />
                {!data && <p class="encounter-muted">…</p>}
                {own.length > 0 && <p class="encounter-column-title">My collections</p>}
                {own.map(c => <CollectionItem key={c.id} id={c.id} label={c.name} />)}
                {data && <p class="encounter-column-title">Subscriptions</p>}
                {subscribed.map(c => <CollectionItem key={c.id} id={c.id} label={collectionLabel(c)} />)}
                {data && !subscribed.length && (
                    <p class="encounter-muted encounter-no-subscriptions">
                        None yet: find public collections in the <a href="/bestiary" target="_blank" rel="noopener">bestiary</a>.
                    </p>
                )}
            </div>
        </div>
    );
}

export function CreaturesColumn() {
    const filter = creatureFilter.value;
    const data = bestiary.value;
    const list = pickedCreatures.value;
    const picked = pickedForPreview.value;
    const kindLabel = (kind: string) => sheetKinds.find(k => k.kind === kind)?.label ?? kind;
    const collections = data?.collections ?? [];
    const own = collections.some(c => c.id === filter.collection && c.own);
    return (
        <div class="encounter-column" data-column="creatures">
            <div class="encounter-column-header layout-column encounter-creature-filter">
                <input type="search" class="encounter-creature-search" placeholder="Search creatures" aria-label="Search creatures"
                    value={filter.q} onInput={e => filterCreatures({ q: e.currentTarget.value })} />
                {own && filter.collection !== null && <NewCreature key={filter.collection} collectionId={filter.collection} />}
            </div>
            <div class="encounter-column-body encounter-creature-list" role="listbox" aria-label="Creatures" aria-busy={pickerReading.value}>
                {list === null && <p class="encounter-muted">…</p>}
                {list?.length === 0 && (
                    <p class="encounter-muted">{collections.length === 0 ? "The bestiary is empty: save NPCs or sheets to a collection." : "No creature matches."}</p>
                )}
                {list?.map(c => (
                    <div key={c.id} role="option" aria-selected={c.id === picked} data-creature-id={c.id}
                        class={c.id === picked ? "encounter-creature selected" : "encounter-creature"}
                        title="Double-click to add one to the combat"
                        onClick={() => previewCreature(c)} onDblClick={() => addCreature(c.id, 1)}>
                        <span class="encounter-creature-text">
                            <span class="encounter-creature-name">{c.name}</span>
                            {/* Empty once the author is gone, still a line: the rows are of one height. */}
                            <span class="encounter-muted encounter-creature-author">{byline(c)}</span>
                        </span>
                        <span class="encounter-muted" title={kindLabel(c.kind)}>{kindInitials(kindLabel(c.kind))}</span>
                        <button type="button" class="encounter-add-creature" title="Add one to the combat" aria-label={`Add ${c.name} to the combat`}
                            onClick={e => {
                                // Not a preview: its sheet would be read for nothing.
                                e.stopPropagation();
                                addCreature(c.id, 1);
                            }}
                            onDblClick={e => e.stopPropagation()}>+ Add</button>
                    </div>
                ))}
            </div>
            {data && <div class="encounter-column-footer encounter-muted encounter-quota">{quotaText(data.quota)}</div>}
        </div>
    );
}

/** The kind of the new creature, when there is more than one, and the button that makes it: the bestiary page's NewCreature. */
function NewCreature({ collectionId }: { collectionId: number }) {
    const [kind, setKind] = useState<SheetKind>(sheetKinds[0]?.kind ?? "black_crusade");
    return (
        <div class="layout-row encounter-new-creature">
            {sheetKinds.length > 1 && (
                <select class="encounter-new-creature-kind" value={kind} aria-label="Kind of the new creature"
                    onChange={e => setKind(e.currentTarget.value as SheetKind)}>
                    {sheetKinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
            )}
            <button type="button" class="encounter-new-creature-btn" onClick={() => void newCreature(collectionId, kind)}>New creature</button>
        </div>
    );
}

const renderPreview = (sheet: SheetInstance, box: HTMLElement, css: CSSStyleSheet) => renderStatBlockView(sheet, box, css, true);

/** The creature previewed in the fourth column: its stat block, read only and without rolls. */
export function CreaturePreview({ creature }: { creature: Creature }) {
    const box = useRef<HTMLDivElement>(null);
    const sheet = sheetOf(creature.id);
    useSheetView(box, sheet, renderPreview);
    const collection = bestiary.value?.collections.find(c => c.id === creature.collectionId);
    return (
        <div class="statblock-picked statblock-preview" data-creature-id={creature.id}>
            <div class="statblock-header">
                <span class="statblock-name">{creature.name}</span>
                <span class="spacer" />
                {/* The room's socket edits only the sheets of the room: a creature is edited on its page. */}
                {collection?.own && (
                    <a class="statblock-edit-creature" href={`/bestiary?collection=${creature.collectionId}&creature=${creature.id}`}
                        target="_blank" rel="noopener">Edit in bestiary ↗</a>
                )}
            </div>
            {collection && <div class="encounter-muted statblock-collection">{collectionLabel(collection)}</div>}
            {sheet ? <div class="statblock-body" ref={box} /> : <p class="encounter-muted">…</p>}
        </div>
    );
}
