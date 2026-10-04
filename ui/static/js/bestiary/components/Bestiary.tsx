// The /bestiary page: collections, the creatures of the one picked and the
// stat block of the creature picked (_prd/gm_mode/mockups/bestiary.html),
// whose full sheet opens over the page.
import { creatureSheet, creatureSheetOpen, toasts } from "../state";
import { closeCreatureSheet } from "../actions";
import { SheetPopup } from "../../room/components/SheetPopup";
import { Collections } from "./Collections";
import { CollectionPanel } from "./CollectionPanel";
import { CreaturePanel } from "./CreaturePanel";
import { Dialogs } from "./Dialogs";
import { RollFeed } from "./RollFeed";

export function Bestiary() {
    return (
        <div class="bestiary-grid">
            <Collections />
            <CollectionPanel />
            <CreaturePanel />
            {creatureSheetOpen.value && <SheetPopup sheet={creatureSheet.value} close={closeCreatureSheet} />}
            <Dialogs />
            <RollFeed />
        </div>
    );
}

/** The notices of the page, rendered into the .toasts live region. */
export function Toasts() {
    return <>{toasts.value.map(t => <div key={t.id} class="toast">{t.message}</div>)}</>;
}
