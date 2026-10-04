// The catalog of public collections in the middle panel: a search by name,
// the last published first or the first.
import type { CatalogRow } from "../types.gen";
import { catalogNext, catalogQuery, catalogRows, catalogSort, subscribedCollections } from "../state";
import { loadCatalog, openFromCatalog, setCatalogSearch, subscribe, unsubscribe } from "../actions";

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
                <tr><th>Name</th><th>Owner</th><th>Entries</th><th>Published</th><th>Subscribed</th></tr>
            </thead>
            <tbody>
                {rows.map(c => (
                    <tr key={c.id} data-collection-id={c.id} tabIndex={0}
                        onClick={() => void openFromCatalog(c)}
                        onKeyDown={e => {
                            // Enter on the row's checkbox is that checkbox's.
                            if (e.key === "Enter" && e.target === e.currentTarget) void openFromCatalog(c);
                        }}>
                        <td>
                            <div class="bestiary-catalog-name">
                                {c.name}
                                {c.own && <span class="bestiary-chip bestiary-yours">yours</span>}
                            </div>
                            {/* One line of it, all on hover; still a line without one: the rows are of one height. */}
                            <div class="bestiary-muted bestiary-catalog-description" title={c.description || undefined}>{c.description}</div>
                        </td>
                        <td class="bestiary-muted">{c.owner}</td>
                        <td>{c.creatures}</td>
                        <td class="bestiary-muted">{new Date(c.publishedAt).toLocaleDateString()}</td>
                        <td>
                            {!c.own && (
                                <input type="checkbox" class="custom bestiary-catalog-subscribe" checked={subscribed.has(c.id)}
                                    aria-label={`Subscribed to ${c.name}`}
                                    // Subscribing leaves the catalog open.
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => {
                                        // The box shows the list of subscriptions: a refused request leaves it as it was.
                                        e.currentTarget.checked = subscribed.has(c.id);
                                        void (subscribed.has(c.id) ? unsubscribe(c.id) : subscribe(c.id));
                                    }} />
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
