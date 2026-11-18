// Techno Arcana: its heading and bar, with cognition, energy, the
// Compensation Roll and the Processes, over the tabs of tech powers
// (powers/Powers.tsx), and what a tech power has of its own.
import { useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { useDropdown } from "../components/Dropdown";
import { useSheet } from "../components/context";
import { NumberField, Row, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import type { Rule } from "../components/kindParts";
import { numberAt, peekAt } from "../core/sync";
import type { SheetSignals } from "../schema/sheet";
import { bonusSuccessesOf } from "../characteristics/characteristicRules";
import { BlockHeading } from "../rolls/BlockSettings";
import { CurrentResource } from "../rolls/ResourceField";
import { rollBonusSuccesses } from "../rolls/rollBase";
import { firstTestOption } from "../rolls/testOptionRules";
import { ExtraModifier, RollResult, baseAndExtras, extraNames, rollLabel, useRollTest } from "../rolls/rollParts";
import { BaseColumn, PowerTabs, type PowerSort } from "../powers/Powers";
import { COMPENSATION, activateTechPower, compensate } from "./activation";
import { hardwareAt } from "./hardware";
import { PriceColumn, ProcessList, ProcessPill, TechTraitsToggle, TestBonusColumn, hasCognitionFor } from "./Processes";
import { compensationDue, isCompiledFor, resourceStat, techTraitsAt, technoRule } from "./tech";
import { TECH_FIELD } from "./techDamage";
import { TechResourceField } from "./TechResourceField";
import { listFormat, t } from "../../i18n";

const int = (state: SheetSignals, path: string) => parseInt(String(peekAt(state, path)), 10) || 0;

const techTotal = (state: SheetSignals, rollPath: string, test: string) => baseAndExtras(state, rollPath, test, "techPower") + numberAt(state, `${rollPath}.modifier`);

/** The compensation roll of techno arcana: T − 10 × X, plus the enabled extras. */
const compensationTotal = (state: SheetSignals, rollPath: string) =>
    baseAndExtras(state, rollPath, "T", "compensation") - 10 * numberAt(state, `${rollPath}.modifier`);

const TECHNO_RULES: readonly Rule[] = [
    {
        field: "price",
        label: t("sheet.termsPowers.tech.price"),
        title: t("sheet.tech.rule.priceTitle"),
    },
    {
        field: "processes",
        label: t("sheet.tech.processes"),
        title: t("sheet.tech.rule.processesTitle"),
    },
    {
        field: "hardware",
        label: t("sheet.termsPowers.tech.hardware"),
        title: t("sheet.tech.rule.hardwareTitle"),
    },
];

function TechnoArcanaHeading() {
    return (
        <BlockHeading level="h2" heading={t("sheet.terms.tab.technoArcana")} block="technoArcana" rolls={t("sheet.tech.powers")} rules={TECHNO_RULES}
            title={t("sheet.tech.settingsTitle")} />
    );
}

export function TechRoll({ path, close }: { path: string; close: () => void }) {
    const { state, actions, rolls, canEdit } = useSheet();
    const rollPath = `${path}.roll`;
    const test = useRollTest("technoArcana", rollPath);
    const hardware = useComputed(() => (technoRule(state, "hardware") ? hardwareAt(state, path) : null));
    const total = useComputed(() => techTotal(state, rollPath, test.value ?? "") + (hardware.value?.mod ?? 0));
    const traits = useComputed(() => techTraitsAt(state, path)).value;
    // Whether this activation holds the power in a Process and how much 🗲 it pays with Fatigue, chosen for it alone.
    const process = useSignal(true);
    const asFatigue = useSignal(0);
    // A viewer's roll spends nothing, so lacking the ⚙ or a compilation does not stop it.
    const noCognition = canEdit && !hasCognitionFor(state, traits);
    const notCompiled = canEdit && !isCompiledFor(state, path, traits);
    const stop = noCognition ? t("sheet.tech.roll.noCognition") : notCompiled ? t("sheet.tech.roll.notCompiled") : null;
    const roll = () => {
        const x = int(state, `${rollPath}.x`);
        const worst = hardware.peek()?.worst;
        const label = rollLabel(String(peekAt(state, `${path}.name`) || t("sheet.tech.roll.unknownPower")), [
            ...(traits.price.x ? [`X = ${x}`] : []),
            ...(worst ? [`${worst.quality}.Q`] : []),
            ...extraNames(state, rollPath),
        ]);
        const versus = traits.auto ? null : { target: total.peek(), bonusSuccesses: rollBonusSuccesses(state, test.peek()), label };
        void activateTechPower({ state, actions, rolls }, path, {
            x, process: !!traits.process && process.peek(), test: versus, energyAsFatigue: asFatigue.peek(),
        });
        close();
    };
    return (
        <Scope dataId="roll" class="roll-dropdown power-roll tech-roll visible">
            <BaseColumn label={t("common.test")} block="technoArcana" />
            <PriceColumn path={path} traits={traits} process={process} asFatigue={asFatigue} />
            <TestBonusColumn hardware={hardware.value} />
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            {traits.auto ? (
                <RollResult total={total} onRoll={roll} button={t("sheet.tech.roll.activate")} disabled={!canEdit || stop !== null}
                    title={stop ?? t("sheet.tech.roll.autoTitle")} />
            ) : (
                <RollResult total={total} onRoll={roll} disabled={test.value === null || stop !== null} title={stop ?? undefined} />
            )}
        </Scope>
    );
}

function TechFields() {
    return (
        <>
            <div class="layout-row">
                <Row cls="subtypes" label={`${t("sheet.termsPowers.field.subtypes")}:`}><TextField field="subtypes" /></Row>
                <Row cls="range" label={`${t("sheet.termsPowers.field.range")}:`}><TextField field="range" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="implants" label={`${t("sheet.tech.implants")}:`}><TextField field="implants" /></Row>
                <Row cls="price" label={`${t("sheet.termsPowers.tech.price")}:`}><TextField field="price" /></Row>
                <Row cls="process" label={`${t("sheet.termsPowers.tech.process")}:`}><TextField field="process" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="test" label={`${t("common.test")}:`}><TextField field="test" /></Row>
                <Row cls="action" label={`${t("sheet.termsPowers.field.action")}:`}><TextField field="action" /></Row>
            </div>
        </>
    );
}

const TECH: PowerSort = {
    Roll: TechRoll,
    Traits: TechTraitsToggle,
    Pill: ProcessPill,
    Fields: TechFields,
    field: TECH_FIELD,
    damageLabel: (state, path) => String(peekAt(state, `${path}.name`) || t("sheet.termsPowers.tech.techPower")),
    collection: "techPowers",
    newRoll: (state, defaults) => ({ ...defaults.techPower, testOption: firstTestOption(state, "technoArcana") }),
    prefix: "tech-powers",
    itemClass: "tech-power",
    tabGroup: "techno-tabs",
};

/**
 * The Compensation Roll. After a Compensator power paid its 🗲, it stands out
 * and says what was paid; its roll then gives back one for each Success. The
 * player decides: letting it go keeps the price as paid.
 */
export function CompensationRoll() {
    const { state, actions, rolls, canEdit } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const rollPath = "technoArcana.compensationRoll";
    const total = useComputed(() => compensationTotal(state, rollPath));
    const due = useComputed(() => compensationDue(state)).value;
    const roll = () => {
        const modifier = parseInt(String(peekAt(state, `${rollPath}.modifier`)), 10) || 0;
        const compensator = t("sheet.termsPowers.techType.compensator");
        const label = rollLabel(due ? `${compensator}, ${due.name}` : compensator, [`X = ${modifier}`, ...extraNames(state, rollPath)]);
        const outcome = rolls.versus(total.peek(), bonusSuccessesOf(state, "T"), label);
        const power = String(peekAt(state, `${COMPENSATION}.power`) ?? "");
        if (due) void outcome.then(o => { if (o) compensate({ state, actions }, o.success ? o.degrees : 0, power); });
        dropdown.close();
    };
    const paid = due ? listFormat("conjunction").format([
        ...(due.energy > 0 ? [`${due.energy} 🗲`] : []),
        ...(due.fatigue > 0 ? [t("sheet.tech.compensation.fatigue", { count: due.fatigue })] : []),
    ]) : "";
    return (
        <Scope dataId="compensationRoll" class="dropdown-parent" elRef={ref}>
            <button type="button" class={`compensation-toggle${due ? " attention" : ""}${dropdown.open ? " active" : ""}`}
                title={due ? t("sheet.tech.compensation.dueTitle", { name: due.name, paid }) : undefined}
                onClick={dropdown.toggle}>{t("sheet.termsPowers.rollDomain.compensation")}</button>
            {dropdown.open && <div class="roll-dropdown roll-dropdown-centered roll-dropdown-stacked compensation-dropdown visible">
                <span class="roll-dropdown-description">{t("sheet.tech.compensation.formula")}</span>
                {due && (
                    <div class="compensation-due" data-id="compensationDue">
                        <span>{t("sheet.tech.compensation.due", { name: due.name, x: due.x, paid })}</span>
                        {canEdit && (
                            <button type="button" class="compensation-let-go" data-id="letGo" title={t("sheet.tech.compensation.letGoTitle")}
                                onClick={() => compensate({ state, actions }, 0, String(peekAt(state, `${COMPENSATION}.power`) ?? ""))}>{t("sheet.tech.compensation.letGo")}</button>
                        )}
                    </div>
                )}
                <div class="roll-columns-row">
                    <div class="roll-column base">
                        <label class="column-label">X:</label>
                        <div class="roll-column-content">
                            <NumberField field="modifier" class="short" />
                        </div>
                    </div>
                    <ExtraModifier n={1} />
                    <ExtraModifier n={2} />
                    <RollResult total={total} onRoll={roll} />
                </div>
            </div>}
        </Scope>
    );
}

/** Cognition or energy as current / max, as the mana of Pathfinder Crusade (Mana.tsx). */
function TechPool({ label, field, max }: { label: string; field: "currentCognition" | "currentEnergy"; max: "cognitionMax" | "energyMax" }) {
    return (
        <span class="resource-stat pool-fraction">
            <label>{`${label}:`}
                <CurrentResource field={field} max={s => resourceStat(s, max).total} />
            </label>
            {/* The max out of the label: a click in its dropdown would go to the current. */}
            <span class="pool-slash">/</span>
            <TechResourceField stat={max} />
        </span>
    );
}

export function TechnoArcana() {
    return (
        <>
            <TechnoArcanaHeading />
            <Scope dataId="technoArcana" class="layout-column">
                <div id="techno-arcana-bar" class="layout-column centered-bar">
                    <div class="layout-row pool-row">
                        <TechPool label={t("sheet.termsPowers.resource.cognition")} field="currentCognition" max="cognitionMax" />
                        <span class="resource-stat">{t("sheet.tech.restorePerTurn")} <TechResourceField stat="cognitionRestore" /></span>
                    </div>
                    <div class="layout-row pool-row">
                        <TechPool label={t("sheet.termsPowers.resource.energy")} field="currentEnergy" max="energyMax" />
                        <span class="resource-stat">{t("sheet.tech.restorePerTurn")} <TechResourceField stat="energyRestore" /></span>
                        <CompensationRoll />
                    </div>
                    <ProcessList />
                </div>
                <PowerTabs sort={TECH} />
            </Scope>
        </>
    );
}
