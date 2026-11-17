// Spellcasting, the class traits of a caster of Pathfinder Crusade
// (magic/spellcastingRules.ts): the row that picks them first in the Magic tab,
// in place of the gift, what it says of the base PR, the variant a PR spell's
// roll is cast by while two PR variants are ticked, and the variants in the
// stat block. Only the layout of Pathfinder Crusade includes the row and the
// stat block line; the roll's column needs two PR variants ticked, which a
// sheet without the spellcasting block, Black Crusade, never has.
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { t } from "../../i18n";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox } from "../components/fields";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue, type SpellcastingVariant, type StatSet } from "../schema/constants";
import { prCapWarning, prVariants, spellVariant, tickedVariants } from "./spellcastingRules";

/** The label of the gift of a PR variant, as the kind's Psykana types name it: "Arcane". */
function giftLabel(stats: StatSet, v: SpellcastingVariant): string {
    const gift = stats.psykanaTypes.find(o => optionValue(o) === v.gift);
    return gift ? optionLabel(gift) : v.gift ?? "";
}

/** The row of the variant in the table of the rules, as its toggle's title. */
function variantTitle(stats: StatSet, v: SpellcastingVariant): string {
    if (v.way === "arts") return t("sheet.magicPf.spellcasting.artsTitle", { trait: v.trait, class: v.label, pool: v.pool ?? "", base: v.base });
    return t("sheet.magicPf.spellcasting.prTitle", {
        trait: v.trait, test: v.test ?? "", base: v.base, gift: giftLabel(stats, v),
        preparation: v.prepares ? t("sheet.magicPf.spellcasting.prepares") : t("sheet.magicPf.spellcasting.knows"),
    });
}

/** What the variant gives, under its name in the list: "Cast on I · Arcane gift · Mana 2×I.b+2×bPR · prepares". */
function variantSummary(stats: StatSet, v: SpellcastingVariant): string {
    if (v.way === "arts") return t("sheet.magicPf.spellcasting.artsSummary", { class: v.label, pool: v.pool ?? "", base: v.base });
    return [
        t("sheet.magicPf.spellcasting.castOn", { test: v.test ?? "" }),
        t("sheet.magicPf.spellcasting.gift", { gift: giftLabel(stats, v) }),
        `${t("sheet.termsPf.magic.mana")} ${v.base}`,
        ...(v.prepares ? [t("sheet.magicPf.spellcasting.preparesShort")] : []),
    ].join(" · ");
}

const WAYS: readonly { way: SpellcastingVariant["way"]; label: string }[] = [
    { way: "pr", label: t("sheet.magicPf.ways.pr") },
    { way: "arts", label: t("sheet.termsPf.magic.arts") },
];

/**
 * The variants ticked, as one button that opens the list of all of them: a
 * caster ticks those of their classes. One line however many the kind has.
 */
export function SpellcastingRow() {
    const { state, stats } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const labels = useComputed(() => tickedVariants(state).map(v => v.label).join(", ")).value;
    return (
        <Scope dataId="spellcasting" class="layout-row spellcasting-row">
            <span class="spellcasting-label">{`${t("sheet.termsPf.magic.spellcasting")}:`}</span>
            <div class="spellcasting-picker dropdown-parent" ref={ref}>
                <button type="button" data-id="picker" class={dropdown.open ? "spellcasting-summary active" : "spellcasting-summary"}
                    aria-expanded={dropdown.open} title={t("sheet.magicPf.spellcasting.title")} onClick={dropdown.toggle}>
                    {labels || <span class="spellcasting-none">{t("common.none")}</span>}
                </button>
                {dropdown.open && (
                    <div class="roll-dropdown roll-dropdown-centered spellcasting-dropdown visible">
                        {WAYS.map(({ way, label }) => {
                            const variants = stats.spellcasting.filter(v => v.way === way);
                            if (variants.length === 0) return null;
                            return (
                                <div key={way} class="spellcasting-group">
                                    <span class="column-label">{label}</span>
                                    {variants.map(v => (
                                        <label key={v.key} class="spellcasting-option" title={variantTitle(stats, v)}>
                                            <Checkbox field={v.key} class="custom" />
                                            <span>
                                                <span class="spellcasting-option-label">{v.label}</span>
                                                <span class="spellcasting-option-text">{variantSummary(stats, v)}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Scope>
    );
}

/** Above the base PR, which it marks, while it is past the bonus of the casting characteristic; the PR is not stopped. */
export function PRCapWarning() {
    const { state } = useSheet();
    const warning = useComputed(() => prCapWarning(state)).value;
    if (!warning) return null;
    return <span class="pr-cap-warning" data-id="prCap" title={warning}>{warning}</span>;
}

/** The PR variants ticked, first on the PR line of the stat block. */
export function StatSpellcasting() {
    const { state } = useSheet();
    const labels = useComputed(() => prVariants(state).map(v => v.label).join(", ")).value;
    return labels ? <span data-id="spellcasting" title={t("sheet.termsPf.magic.spellcasting")}>{labels}</span> : null;
}

/**
 * The PR variant the spell at `path` is cast by, first in its roll: it gives
 * the spell its gift, so whether the roll has a Kick, the characteristic of
 * Cast and whether the spell is prepared. Shown while a PR variant is ticked,
 * one alone too, so the roll always says what it is cast by; the first is the
 * default, so a spell keeps "" until one is picked.
 */
export function SpellcastingColumn({ path }: { path: string }) {
    const { state, actions, canEdit, stats } = useSheet();
    const variants = useComputed(() => prVariants(state)).value;
    const current = useComputed(() => spellVariant(state, path)?.key ?? "").value;
    if (variants.length === 0) return null;
    return (
        <div class="roll-column spellcasting-column">
            <label class="column-label">{t("sheet.termsPf.magic.spellcasting")}</label>
            <div class="roll-column-content">
                <select data-id="spellcasting" value={current} disabled={!canEdit}
                    title={t("sheet.magicPf.spellcasting.columnTitle")}
                    onChange={e => actions.change(`${path}.roll.spellcasting`, e.currentTarget.value)}>
                    {variants.map(v => (
                        <option key={v.key} value={v.key} title={t("sheet.magicPf.spellcasting.optionTitle", { test: v.test ?? "", gift: giftLabel(stats, v) })}>
                            {v.label}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}
