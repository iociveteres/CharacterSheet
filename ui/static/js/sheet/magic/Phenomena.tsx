// The phenomena roll of the psykana bar (magic/psychic.ts phenomena): 1d100
// with the kick of the last cast, the sustained powers, the power's own
// modifier and other ones. The button stands out when the last cast calls for
// phenomena; whether they happen is the players' call, so it never rolls by
// itself. Shown while the sheet counts phenomena (settings.psykana).
import { useRef } from "preact/hooks";
import { t } from "../../i18n";
import { useComputed } from "@preact/signals";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, TextField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { phenomena, psykanaRule, type Phenomena as PhenomenaState } from "./psychic";
import type { PsykanaTerms } from "../schema/constants";
import { rollLabel } from "../rolls/rollParts";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** What the dropdown says of the last cast; short, as the power's own row names it. */
function note({ power }: PhenomenaState, terms: PsykanaTerms): string {
    if (!power) return terms.noCastYet;
    if (power.safe) return t("sheet.magic.phenomena.note.safe");
    switch (power.reason) {
        case "pushed": return t("sheet.magic.phenomena.note.pushed");
        case "doubles": return t("sheet.magic.phenomena.note.doubles");
        case "99": return t("sheet.magic.phenomena.note.rolled99");
        default: return t("sheet.magic.phenomena.note.none");
    }
}

function PhenomenaModRow({ itemId }: { itemId: string }) {
    return (
        <Scope dataId={itemId} class="phenomena-mod">
            <Checkbox field="enabled" class="custom" title={t("sheet.magic.phenomena.modCounts")} />
            <TextField field="name" placeholder={t("sheet.magic.phenomena.modPlaceholder")} />
            <NumberField field="value" placeholder="0" />
            <DragHandle />
            <DeleteButton itemPath={joinPath(usePath(), itemId)} />
        </Scope>
    );
}

function PhenomenaDropdown({ summary, onRoll, onDiscard }: { summary: PhenomenaState; onRoll: () => void; onDiscard: () => void }) {
    const { terms } = useSheet();
    const value = (key: string) => signed(summary.parts.find(p => p.key === key)?.value ?? 0);
    const part = (key: string) => summary.parts.find(p => p.key === key)!;
    return (
        <div class="roll-dropdown phenomena-dropdown visible">
            <span class="column-label">{t("sheet.magic.phenomena.heading")}</span>
            <p class={summary.power?.reason ? "phenomena-note attention" : "phenomena-note"} data-id="phenomenaNote" title={note(summary, terms)}>
                {note(summary, terms)}
            </p>
            <div class="phenomena-row" title={t("sheet.magic.phenomena.natureTitle")}>
                <span>{part("nature").label}</span>
                <span class="phenomena-value" data-id="nature">{value("nature")}</span>
            </div>
            <div class="phenomena-row" title={terms.sustainPenaltyTitle}>
                <label>{terms.sustainedLabel} <NumberField field="sustainPenalty" class="short" /></label>
                <span class="phenomena-value" data-id="sustained">{value("sustained")}</span>
            </div>
            <div class="phenomena-row" title={terms.setUnderGearTitle}>
                <span>{part("power").label}</span>
                <span class="phenomena-value" data-id="power">{value("power")}</span>
            </div>
            <div class="phenomena-other">
                <span class="column-label">{t("common.other")}</span>
                <span class="phenomena-value" data-id="other">{value("other")}</span>
            </div>
            <ItemGrid dataId="phenomenaMods.items" class="phenomena-mods" itemClass="phenomena-mod" idPrefix="phenomena-mod"
                renderItem={id => <PhenomenaModRow itemId={id} />} />
            <div class="phenomena-result">
                <span class="column-label">{t("common.total")}</span>
                <span class="phenomena-total" data-id="phenomenaTotal">{`1d100${summary.total === 0 ? "" : signed(summary.total)}`}</span>
                {summary.power?.reason && (
                    <button type="button" class="phenomena-discard" data-id="discardPhenomena"
                        title={t("sheet.magic.phenomena.discardTitle")} onClick={onDiscard}>{t("sheet.magic.phenomena.discard")}</button>
                )}
                <button type="button" class="button-colored" data-id="rollPhenomena" onClick={onRoll}>{t("common.roll")}</button>
            </div>
        </div>
    );
}

export function PhenomenaRoll() {
    const { state, actions, rolls, preview, terms } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const shown = useComputed(() => psykanaRule(state, "phenomena")).value;
    const summary = useComputed(() => phenomena(state));
    if (!shown || preview) return null;
    const called = !!summary.value.power?.reason;
    // Rolled or discarded, the button no longer calls for them.
    const settle = () => {
        const { power } = summary.peek();
        if (power?.reason) actions.change(`${power.path}.cast.phenomena`, "");
        dropdown.close();
    };
    const roll = () => {
        const { total, power } = summary.peek();
        const kick = power && !power.safe && power.kick > 0 ? [t("sheet.magic.roll.kick", { kick: power.kick })] : [];
        void rolls.exact(`1d100${total === 0 ? "" : signed(total)}`, rollLabel(t("sheet.magic.phenomena.label"), power ? [power.name, ...kick] : []));
        settle();
    };
    return (
        <div class="phenomena-roll dropdown-parent" ref={ref}>
            <button type="button" data-id="phenomenaToggle"
                class={`phenomena-toggle${called ? " attention" : ""}${dropdown.open ? " active" : ""}`}
                title={called ? note(summary.value, terms) : t("sheet.magic.phenomena.rollTitle")} onClick={dropdown.toggle}>
                {t("sheet.magic.phenomena.label")}
            </button>
            {dropdown.open && <PhenomenaDropdown summary={summary.value} onRoll={roll} onDiscard={settle} />}
        </div>
    );
}
