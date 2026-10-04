// The catalog of public collections in the middle panel: a search by name and
// by a tag of the collection, the last published first or the first.
import type { CatalogRow } from "../types.gen";
import { catalogNext, catalogQuery, catalogRows, catalogSort, catalogTag, subscribedCollections, tagSuggestions } from "../state";
import { loadCatalog, openFromCatalog, setCatalogSearch, subscribe, unsubscribe } from "../actions";
import { Tags } from "./common";

export function Catalog() {
    const rows = catalogRows.value;
    return (
        <div class="bestiary-catalog">
            <div class="bestiary-header">
                <h2 class="bestiary-title">Public collections</h2>
            </div>
            <div class="bestiary-toolbar">
                <input type="search" class="bestiary-search bestiary-catalog-search" placeholder="Search collections"
                    aria-label="Search collections" value={catalogQuery.value}
                    onInput={e => setCatalogSearch({ q: e.currentTarget.value })} />
                <input type="search" class="bestiary-catalog-tag" placeholder="Tag" aria-label="Collection tag"
                    list="bestiary-catalog-tags" value={catalogTag.value}
                    onInput={e => setCatalogSearch({ tag: e.currentTarget.value })} />
                <datalist id="bestiary-catalog-tags">
                    {tagSuggestions.value.collections.map(t => <option key={t} value={t} />)}
                </datalist>
                <select class="bestiary-catalog-sort" aria-label="Order" value={catalogSort.value}
                    onChange={e => setCatalogSearch({ sort: e.currentTarget.value === "old" ? "old" : "new" })}>
                    <option value="new">Newest</option>
                    <option value="old">Oldest</option>
                </select>
            </div>
            {rows === null
                ? <p class="bestiary-muted">Loading…</p>
                : rows.length === 0
                    ? <p class="bestiary-muted">No public collection matches.</p>
                    : <CatalogTable rows={rows} />}
            {catalogNext.value !== null && (
                <button type="button" class="bestiary-catalog-more" onClick={() => void loadCatalog(true)}>More</button>
            )}
        </div>
    );
}

function CatalogTable({ rows }: { rows: CatalogRow[] }) {
    // A catalog row does not know the user's subscriptions; the list does.
    const subscribed = new Set(subscribedCollections.value.map(c => c.id));
    return (
        <table class="bestiary-table bestiary-catalog-table">
            <thead>
                <tr><th>Name</th><th>Owner</th><th>Creatures</th><th>Tags</th><th>Published</th><th /></tr>
            </thead>
            <tbody>
                {rows.map(c => (
                    <tr key={c.id} data-collection-id={c.id} tabIndex={0}
                        onClick={() => void openFromCatalog(c)}
                        onKeyDown={e => {
                            // Enter on the row's button is that button's.
                            if (e.key === "Enter" && e.target === e.currentTarget) void openFromCatalog(c);
                        }}>
                        <td class="bestiary-catalog-name">
                            {c.name}
                            {c.own && <span class="bestiary-chip bestiary-yours">yours</span>}
                        </td>
                        <td class="bestiary-muted">{c.owner}</td>
                        <td>{c.creatures}</td>
                        <td><Tags tags={c.tags} /></td>
                        <td class="bestiary-muted">{new Date(c.publishedAt).toLocaleDateString()}</td>
                        <td>
                            {!c.own && (
                                <button type="button" class="bestiary-catalog-subscribe" aria-pressed={subscribed.has(c.id)}
                                    title={subscribed.has(c.id) ? "Unsubscribe" : undefined}
                                    onClick={e => {
                                        // Subscribing leaves the catalog open.
                                        e.stopPropagation();
                                        void (subscribed.has(c.id) ? unsubscribe(c.id) : subscribe(c.id));
                                    }}>
                                    {subscribed.has(c.id) ? "Subscribed" : "Subscribe"}
                                </button>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
