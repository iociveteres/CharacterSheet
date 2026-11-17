// The left panel: the user's collections, the public ones of others they
// subscribed to, and the way to the catalog.
import type { BestiaryCollection } from "../types.gen";
import { center, collections, ownCollections, selectedCollectionId, subscribedCollections } from "../state";
import { openCatalog, openDialog, selectCollection } from "../actions";
import { t } from "../../i18n";

export function Collections() {
    const loading = collections.value === null;
    const own = ownCollections.value;
    const subscribed = subscribedCollections.value;
    return (
        <section class="bestiary-panel bestiary-collections" aria-label={t("bestiary.shared.collections")}>
            <div class="bestiary-panel-body">
                <p class="bestiary-section-title">{t("bestiary.shared.myCollections")}</p>
                {loading && <p class="bestiary-muted">{t("common.loading")}</p>}
                <div class="bestiary-section" data-section="own">
                    {own.map(c => <CollectionItem key={c.id} collection={c} />)}
                </div>
                <p class="bestiary-section-title">{t("bestiary.shared.subscriptions")}</p>
                {!loading && subscribed.length === 0 && <p class="bestiary-muted bestiary-no-subscriptions">{t("bestiary.collections.noSubscriptions")}</p>}
                <div class="bestiary-section" data-section="subscribed">
                    {subscribed.map(c => <CollectionItem key={c.id} collection={c} />)}
                </div>
                <button type="button" aria-pressed={center.value === "catalog"}
                    class={center.value === "catalog" ? "button-linklike bestiary-catalog-link selected" : "button-linklike bestiary-catalog-link"}
                    onClick={() => void openCatalog()}>{t("bestiary.collections.viewPublic")}</button>
            </div>
            <div class="bestiary-panel-footer">
                <button type="button" class="bestiary-new-collection" onClick={() => openDialog({ type: "newCollection" })}>
                    {t("bestiary.collections.newCollection")}
                </button>
            </div>
        </section>
    );
}

function CollectionItem({ collection: c }: { collection: BestiaryCollection }) {
    const selected = center.value === "collection" && c.id === selectedCollectionId.value;
    return (
        <button type="button" data-collection-id={c.id} aria-pressed={selected} title={c.own ? c.name : `${c.name} · ${c.owner}`}
            class={selected ? "button-linklike bestiary-collection selected" : "button-linklike bestiary-collection"}
            onClick={() => void selectCollection(c.id)}>
            <span class="bestiary-collection-name">
                {c.name}
                {!c.own && <span class="bestiary-muted"> · {c.owner}</span>}
            </span>
            {c.default && <span class="bestiary-chip bestiary-default">{t("bestiary.collections.default")}</span>}
            {c.own && c.visibility === "public" && <span class="bestiary-chip bestiary-visibility">{t("bestiary.collections.visibility.public")}</span>}
            <span class="bestiary-muted">{c.creatures}</span>
        </button>
    );
}
