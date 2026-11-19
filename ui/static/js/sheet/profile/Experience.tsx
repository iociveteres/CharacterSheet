// Experience: cost settings, totals and the log of advancements. The cost of
// an advancement is computed (profileComputeds.ts).
import { ToggleField, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, type AutocompleteResult, useSheet } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextField } from "../components/fields";
import { valueAt } from "../core/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/AutocompleteField";
import { displayName } from "../components/autocompleteOptions";
import { SuggestField } from "../components/SuggestField";
import { ALIGNMENT_PATHS, EXPERIENCE_LEVELS_BY_TYPE, EXPERIENCE_TYPES, POWER_RATING_LEVELS } from "../schema/constants";
import { aptitudeSuggestions } from "../characteristics/aptitudeSuggestions";
import { isPowerRating, powerRatingCost, spellCostVariant } from "../magic/spellcastingRules";
import { insertToken, tokenAt } from "../characteristics/characteristicSuggestions";
import { t } from "../../i18n";

// The gods and paths of ALIGNMENT_PATHS, which stay English in the sheet: the
// costs compare them with the gods typed in Allied and Hostile.
const GOD_LABELS: { readonly [god: string]: string } = {
    Khorne: t("sheet.terms.god.khorne"),
    Slaanesh: t("sheet.terms.god.slaanesh"),
    Nurgle: t("sheet.terms.god.nurgle"),
    Tzeentch: t("sheet.terms.god.tzeentch"),
};
const PATH_LABELS: { readonly [path: string]: string } = {
    Vanguard: t("sheet.terms.path.vanguard"),
    Berserker: t("sheet.terms.path.berserker"),
    Smith: t("sheet.terms.path.smith"),
    Bladedancer: t("sheet.terms.path.bladedancer"),
    Intriguer: t("sheet.terms.path.intriguer"),
    Hedonist: t("sheet.terms.path.hedonist"),
    Meister: t("sheet.terms.path.meister"),
    Undying: t("sheet.terms.path.undying"),
    Cultist: t("sheet.terms.path.cultist"),
    Sniper: t("sheet.terms.path.sniper"),
    Warlock: t("sheet.terms.path.warlock"),
    Sage: t("sheet.terms.path.sage"),
};

function AlignmentSelect() {
    return (
        <Select field="alignment">
            <option value="Undivided">{t("sheet.terms.god.undivided")}</option>
            {ALIGNMENT_PATHS.map(([god, paths]) => (
                <optgroup key={god} label={GOD_LABELS[god]}>
                    {paths.map(p => <option key={p} value={`${god} (${p})`}>{`${GOD_LABELS[god]} (${PATH_LABELS[p]})`}</option>)}
                </optgroup>
            ))}
        </Select>
    );
}

/** A list of aptitudes; `general` offers General, which the character has without naming it. */
function AptitudesField({ general, class: cls, placeholder }: { general: boolean; class?: string; placeholder: string }) {
    const { stats } = useSheet();
    return (
        <SuggestField field="aptitudes" class={cls} placeholder={placeholder}
            suggest={(query, text) => aptitudeSuggestions(stats, text, query, general)}
            queryAt={tokenAt} insert={insertToken} />
    );
}

/** The requirements of an advancement in one line, "" for none. */
function requirements(req: unknown): string {
    if (typeof req === "string") return req.trim();
    if (Array.isArray(req)) return req.join(", ");
    if (!req || typeof req !== "object") return "";
    const r = req as { race?: string; patron?: string; stats?: unknown; xp_notes?: string; xp?: string };
    const parts: string[] = [];
    if (r.race) parts.push(r.race);
    if (r.patron) parts.push(r.patron);
    if (Array.isArray(r.stats)) parts.push(...r.stats);
    if (r.xp_notes) parts.push(r.xp_notes);
    else if (r.xp) parts.push(`${r.xp} xp`);
    return parts.join(", ");
}

function advancementOption(r: AutocompleteResult) {
    const reqs = requirements(r.requirements);
    return (
        <>
            <div class="ac-header">
                <span class="ac-name">{displayName(r)}</span>
                {r.type ? <span class="ac-type">{String(r.type)}</span> : null}
                {r.experienceCost ? <span class="ac-cost">{`${r.experienceCost} xp`}</span> : null}
            </div>
            <div class="ac-details">
                {r.discipline ? <span class="ac-meta">{r.subdiscipline ? `${r.discipline} / ${r.subdiscipline}` : String(r.discipline)}</span> : null}
                {reqs && <span class="ac-reqs">{t("sheet.profile.experience.requirements", { requirements: reqs })}</span>}
            </div>
        </>
    );
}

function ExperienceItem({ itemId }: { itemId: string }) {
    const { state, stats } = useSheet();
    const path = joinPath(usePath(), itemId);
    // Advancements start collapsed and stay so when a remote batch changes them.
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => true,
        startsCollapsed: () => true,
        autoExpand: false,
    });
    const type = String(valueAt(state, `${path}.type`) ?? "");
    // Power Rating of a kind with its table: bought up to a PR, aptitudes count for nothing.
    const prSource = type === "talent" && isPowerRating(String(valueAt(state, `${path}.name`) ?? ""))
        ? powerRatingCost(state, Number(valueAt(state, `${path}.level`)) || 2)?.source
        : undefined;
    const levels = prSource ? POWER_RATING_LEVELS : EXPERIENCE_LEVELS_BY_TYPE[type];
    const computedCost = levels !== undefined;
    const spellShare = type === "psychicPower" ? spellCostVariant(state) : null;

    return (
        <Scope dataId={itemId} class={collapsed ? "experience-item item-with-description collapsed" : "experience-item item-with-description"} elRef={elRef}>
            <div class="split-header">
                <ToggleField onToggle={toggle}>
                    <AutocompleteField field="name" class="long" itemPath={path} collection="advancements" renderOption={advancementOption} />
                </ToggleField>
                <ReadonlyField field="computedCost" type="number" class="short textlike" />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <div class="layout-row">
                    <label>{t("sheet.profile.experience.type")}:</label>
                    <Select field="type" options={EXPERIENCE_TYPES} />
                    {!computedCost && (
                        <label class="exp-field-cost">{t("sheet.profile.experience.cost")}:
                            <NumberField field="experienceCost" class="short textlike" />
                            {spellShare && <span class="exp-cost-note" title={t("sheet.profile.experience.roundedUp")}>{`${spellShare.label}: ×${spellShare.spellCost}`}</span>}
                        </label>
                    )}
                </div>
                {computedCost && (
                    <>
                        <div class="layout-row exp-field-calc">
                            <label>{t("sheet.profile.experience.level")}:
                                <Select key={prSource ? "pr" : type} field="level" class={`short level-${type}`} numeric options={levels} />
                            </label>
                            {prSource
                                ? <span class="exp-cost-note">{prSource}</span>
                                : <label>{t("sheet.terms.advance.aptitudes")}:
                                    <AptitudesField general placeholder="S,Off" />
                                </label>}
                        </div>
                        {stats.devotion && <div class="layout-row exp-field-calc">
                            <label>{t("sheet.terms.advance.allied")}:
                                <TextField field="alliedTo" placeholder={t("sheet.profile.experience.alliedPlaceholder")} />
                            </label>
                            {type === "characteristic" && (
                                <div class="exp-field-hostile">
                                    <label>{t("sheet.terms.advance.hostile")}:
                                        <TextField field="hostileTo" placeholder={t("sheet.profile.experience.hostilePlaceholder")} />
                                    </label>
                                </div>
                            )}
                        </div>}
                    </>
                )}
            </div>
        </Scope>
    );
}

export function Experience() {
    const { stats } = useSheet();
    return (
        <Scope dataId="experience" class="layout-column quarter-grid-column">
            <h2 class="align-self-center">{t("sheet.terms.block.experience")}</h2>
            <div class="layout-column centered-bar">
                {stats.devotion && <div id="experience-cost-mods" class="layout-row">
                    <label>
                        {t("sheet.profile.experience.useDevotion")}
                        <Checkbox field="useDevotion" class="custom" />
                    </label>
                    <label>{t("sheet.terms.advance.alignment")}:
                        <AlignmentSelect />
                    </label>
                </div>}

                <div id="experience-cost-options" class="layout-row gap-5">
                    <label>
                        {t("sheet.profile.experience.useAptitudes")}
                        <Checkbox field="useAptitudes" class="custom" />
                    </label>
                    <label>{t("sheet.terms.advance.aptitudes")}:
                        <AptitudesField general={false} class="long" placeholder={t("sheet.profile.experience.aptitudesPlaceholder")} />
                    </label>
                </div>

                <div id="experience-bar" class="layout-row">
                    <label>{t("sheet.terms.advance.totalXp")}:</label>
                    <NumberField field="experienceTotal" class="short" />
                    <label>{t("sheet.terms.advance.spentXp")}:</label>
                    <ReadonlyField field="experienceSpent" type="number" class="short" />
                    <label>{t("sheet.terms.advance.remainingXp")}:</label>
                    <ReadonlyField field="experienceRemaining" type="number" class="short" />
                </div>
            </div>

            <ItemGrid
                dataId="experienceLog.items"
                id="experience-log"
                itemClass="experience-item"
                renderItem={id => <ExperienceItem itemId={id} />}
            />
        </Scope>
    );
}
