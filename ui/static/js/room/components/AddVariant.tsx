// "Add variant to bestiary": an NPC copied next to the creature it was made
// of as a new creature, under the name the gamemaster gives it.
import { useState } from "preact/hooks";
import { t } from "../../i18n";
import { variantOf } from "../bestiary/state";
import { addVariant, closeAddVariant } from "../bestiary/actions";
import { closeOnOverlay, useEscape } from "./overlay";

export function AddVariant() {
    const npc = variantOf.value;
    return npc ? <VariantDialog key={npc.sheetId} name={npc.name} creatureName={npc.creatureName} /> : null;
}

function VariantDialog({ name, creatureName }: { name: string; creatureName: string }) {
    const [variant, setVariant] = useState(name);
    useEscape(closeAddVariant);
    const add = () => void addVariant(variant);
    return (
        <div class="overlay open" onClick={closeOnOverlay(closeAddVariant)}>
            <div class="modal layout-column add-variant-modal" role="dialog" aria-modal="true" aria-label={t("room.modals.addVariant.title")}>
                <h3>{t("room.modals.addVariant.heading", { name, creature: creatureName })}</h3>
                <input type="text" class="add-variant-name" aria-label={t("room.modals.addVariant.name")} maxLength={200} value={variant} autoFocus
                    onInput={e => setVariant(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") add();
                    }} />
                <span class="encounter-muted">{t("room.modals.addVariant.note", { creature: creatureName })}</span>
                <div class="actions">
                    <button type="button" class="button-colored" onClick={closeAddVariant}>{t("common.cancel")}</button>
                    <button type="button" class="button-colored add-variant-add" onClick={add}>{t("common.add")}</button>
                </div>
            </div>
        </div>
    );
}
