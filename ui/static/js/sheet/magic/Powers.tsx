// Psykana: its bar over the tabs of psychic powers (powers/Powers.tsx), and
// what a psychic power has of its own.
import type { ComponentChildren } from "preact";
import { t } from "../../i18n";
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { untracked } from "@preact/signals-core";
import { useDropdown } from "../components/Dropdown";
import { useSheet } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextField, Row } from "../components/fields";
import { numberAt, peekAt, textAt, valueAt } from "../core/sync";
import { Scope } from "../components/Scope";
import type { SheetSignals } from "../schema/sheet";
import { castPower } from "./cast";
import { rollBonusSuccesses } from "../rolls/rollBase";
import { firstTestOption } from "../rolls/testOptionRules";
import { BaseColumn, PowerTabs, type PowerSort } from "../powers/Powers";
import {
    canPush, castCap, hasArts, isArts, powerTraits, powerTraitsAt, psykanaRule, rollKick, safePR, sheetPushes, sustainedPowers,
} from "./psychic";
import { addTestOption, spellRollFromTest, testTextNote } from "./spellRoll";
import { PhenomenaRoll } from "./Phenomena";
import { PreparedToggle, usePrepared } from "./Prepared";
import { ArtsChip, ArtsLevel, ArtsTrait } from "./Arts";
import { ArtsRoll } from "./ArtsRoll";
import { SpellcastingColumn } from "./Spellcasting";
import { showsPR } from "./artsRules";
import { castCharacteristic } from "./spellcastingRules";
import { RollRow } from "../rolls/rollParts";
import { SustainColumn, SustainFields, SustainPill, SustainedList, useSustainChoice } from "./Sustain";
import { POWER_DAMAGE, powerPR, uncastPR } from "./powerDamage";
import type { FieldOwner } from "../rolls/ModdedField";
import { PsykanaHeading } from "./PsykanaHeading";
import {
    ExtraModifier, RollResult, TestText, baseAndExtras, extraNames, useRollTest,
} from "../rolls/rollParts";
import { code, label, MOD, NAME, SPACE, type Label } from "../rollLabel";

const int = (state: SheetSignals, path: string) => parseInt(String(peekAt(state, path)), 10) || 0;

/** The label of the test of a cast of the psychic power at `path`, as its roll is set now, on a sheet of `kind`. */
export function psychicRollLabel(state: SheetSignals, path: string, kind: string): Label {
    const rollPath = `${path}.roll`;
    const effectivePR = int(state, `${rollPath}.effectivePR`);
    const kick = rollKick(state, path);
    return label(String(peekAt(state, `${path}.name`) ?? "") || code(SPACE.name, NAME.unknownPower), {
        m: [
            ...(peekAt(state, `${rollPath}.safe`) ? [code(SPACE.mod, MOD.safe)] : []),
            ...(effectivePR > 0 ? [code(SPACE.mod, MOD.effectivePR, { pr: effectivePR })] : []),
            ...(kick > 0 ? [code(SPACE.mod, MOD.kick, { kick })] : []),
            ...extraNames(state, rollPath),
        ],
        k: kind,
    });
}

/** The label of a roll of the damage of the psychic power at `path`, with the PR it counts. */
export const psychicDamageLabel = (state: SheetSignals, path: string, kind: string): Label =>
    label(String(peekAt(state, `${path}.name`) ?? "") || code(SPACE.name, NAME.psychicPower), { m: [`PR ${untracked(() => powerPR(state, path))}`], k: kind });

/**
 * The effective PR of a psychic power's cast. Max casts it normally at the
 * current PR, Safe at half of it without a kick; bonuses are typed in.
 */
function EffectivePrColumn({ path, safe }: { path: string; safe: boolean }) {
    const { state, actions, terms } = useSheet();
    const rollPath = `${path}.roll`;
    const cap = useComputed(() => castCap(state, path)).value;
    const talent = !!valueAt(state, `${path}.ignoreTprPenalty`);
    return (
        <div class="roll-column pr-column effective-pr">
            <label class="column-label">{t("sheet.termsPowers.psy.effectivePR")}</label>
            <div class="roll-column-content">
                <NumberField field="effectivePR" />
                <div class="pr-buttons">
                    <button type="button" data-id="safePR" class={safe ? "pr-button active" : "pr-button"}
                        title={talent ? t("sheet.magic.pr.safeTitleTalent", { pr: safePR(cap) }) : t("sheet.magic.pr.safeTitle", { pr: safePR(cap) })}
                        onClick={() => actions.batch(rollPath, safe ? { safe: false } : { safe: true, effectivePR: safePR(cap), kickPR: 0 })}>
                        {t("sheet.termsPowers.castMode.safe")}
                    </button>
                    <button type="button" data-id="maxPR" class="pr-button"
                        title={talent ? t("sheet.magic.pr.maxTitleTalent", { pr: cap }) : t("sheet.magic.pr.maxTitle", { pr: cap })}
                        onClick={() => actions.batch(rollPath, { safe: false, effectivePR: cap })}>
                        {t("sheet.magic.pr.max")}
                    </button>
                </div>
                {cap <= 0 && <span class="pr-warning" data-id="noPR">{terms.noPRLeft}</span>}
            </div>
        </div>
    );
}

function KickColumn({ path, safe }: { path: string; safe: boolean }) {
    const { state, actions } = useSheet();
    const set = (value: number) => actions.change(`${path}.roll.kickPR`, value);
    return (
        <div class="roll-column pr-column kick" title={safe ? t("sheet.magic.pr.safeNoKick") : undefined}>
            <label class="column-label">{t("sheet.termsPowers.psy.kick")}</label>
            <div class="roll-column-content">
                <NumberField field="kickPR" readOnly={safe} />
                <div class="pr-buttons">
                    <button type="button" data-id="kickZero" class="pr-button" disabled={safe} onClick={() => set(0)}>0</button>
                    <button type="button" data-id="kickMax" class="pr-button" disabled={safe}
                        onClick={() => set(int(state, "psykana.maxPush"))}>{t("sheet.magic.pr.max")}</button>
                </div>
            </div>
        </div>
    );
}

export function PsychicRoll({ path, close }: { path: string; close: () => void }) {
    const { state, actions, rolls, terms, canEdit, castCost, preparation, kindName } = useSheet();
    const rollPath = `${path}.roll`;
    const cast = () => castCharacteristic(state, path);
    const test = useRollTest("psykana", rollPath, cast);
    const total = useComputed(() => psychicTotal(state, path, test.value ?? ""));
    const safe = !!valueAt(state, `${rollPath}.safe`);
    const effectivePR = Number(valueAt(state, `${rollPath}.effectivePR`)) || 0;
    // A cast without PR is none: its damage would count the PR of a normal cast.
    const noPR = effectivePR <= 0;
    const pr = effectivePR + rollKick(state, path);
    // A viewer's roll pays nothing, so what it lacks does not stop it.
    const unpaid = canEdit && castCost ? castCost.shortage(state, pr) : null;
    const choice = useSustainChoice(path);
    // A cast with no PR set opens at the current PR, as Max (or Safe) would set it.
    useEffect(() => {
        if (!canEdit || int(state, `${rollPath}.effectivePR`) > 0) return;
        const cap = castCap(state, path);
        if (cap > 0) actions.change(`${rollPath}.effectivePR`, peekAt(state, `${rollPath}.safe`) ? safePR(cap) : cap);
    }, []);
    const testText = textAt(state, `${path}.psychotest`);
    const note = useComputed(() => testTextNote(state, textAt(state, `${path}.psychotest`), false)).value;
    // What this cast does to the sustaining, chosen for it alone.
    const sustain = useSignal(true);
    const free = useSignal(true);
    const roll = () => {
        const effectivePR = int(state, `${rollPath}.effectivePR`);
        const kickPR = rollKick(state, path);
        void castPower({ state, actions, rolls }, path, {
            effectivePR, kick: kickPR, safe,
            target: total.peek(), bonusSuccesses: rollBonusSuccesses(state, test.peek()), label: psychicRollLabel(state, path, kindName),
            sustain: choice && !choice.full && sustain.peek() ? { free: choice.canBeFree && free.peek() } : null,
            pay: castCost ? () => castCost.pay({ state, actions }, effectivePR + kickPR) : undefined,
        });
        close();
    };
    return (
        <Scope dataId="roll" class="roll-dropdown power-roll psychic-roll visible">
            <SpellcastingColumn path={path} />
            <BaseColumn label={terms.psychotest} block="psykana" cast={cast} />
            <EffectivePrColumn path={path} safe={safe} />
            {/* An Arcane gift cannot push. */}
            {canPush(state, path) && <KickColumn path={path} safe={safe} />}
            {note && (
                <RollRow label={t("common.test")} class="test-text-row">
                    <TestText text={testText} note={note === "mode" ? t("sheet.magic.testText.mode") : t("sheet.magic.testText.unread")} />
                </RollRow>
            )}
            {castCost && <castCost.Row cost={pr} />}
            {preparation && <preparation.Row path={path} />}
            {choice && <SustainColumn choice={choice} sustain={sustain} free={free} />}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={test.value === null || noPR || unpaid !== null}
                title={noPR ? t("sheet.magic.pr.noEffectivePR") : unpaid ?? undefined} />
        </Scope>
    );
}

/** The ⚙ of a psychic power: what its subtypes and Sustained field make of it, and its talent. */
function PowerTraits({ path }: { path: string }) {
    const { terms } = useSheet();
    const ref = useRef<HTMLSpanElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <span class="power-traits dropdown-parent" ref={ref}>
            <button type="button" class={dropdown.open ? "power-traits-toggle active" : "power-traits-toggle"}
                title={terms.powerTraitsTitle} onClick={dropdown.toggle}>⚙</button>
            {dropdown.open && <PowerTraitsDropdown path={path} />}
        </span>
    );
}

function PowerTraitsDropdown({ path }: { path: string }) {
    const { state, terms } = useSheet();
    const traits = useComputed(() => powerTraitsAt(state, path)).value;
    // An Arts spell has no phenomena and takes no PR.
    const arts = useComputed(() => isArts(state, path)).value;
    const phenomenaShown = useComputed(() => psykanaRule(state, "phenomena")).value && !arts;
    const x = (n: number | null | undefined, unknown: string) => (n === null || n === undefined ? unknown : String(n));
    return (
        <div class="roll-dropdown power-traits-dropdown visible">
            <span class="column-label">{t("sheet.magic.traits.heading")}</span>
            <ul class="power-traits-list" data-id="traits">
                <li>{traits.sustainable ? t("sheet.magic.traits.sustainable") : t("sheet.magic.traits.notSustainable")}</li>
                {traits.cycle !== undefined && (
                    <li>{t("sheet.magic.traits.cycle", { n: x(traits.cycle, "?"), x: x(traits.cycle, "X") })}</li>
                )}
                {traits.upkeep !== undefined && (
                    <li>{t("sheet.magicPf.traits.upkeep", { n: x(traits.upkeep, "?"), x: x(traits.upkeep, "X") })}</li>
                )}
                {traits.repeatable !== undefined && (
                    <li>{t("sheet.magic.traits.repeatable", { n: x(traits.repeatable, "?"), x: x(traits.repeatable, "X") })}</li>
                )}
                <ArtsTrait path={path} />
            </ul>
            <SustainFields path={path} />
            {phenomenaShown && (
                <label class="power-traits-phenomena" title={terms.phenomenaModTitle}>
                    {t("sheet.magic.traits.phenomenaMod")} <NumberField field="phenomenaMod" class="short" />
                </label>
            )}
            {!arts && (
                <label class="power-traits-talent" title={t("sheet.magic.traits.ignoresSustainedTitle")}>
                    <Checkbox field="ignoreTprPenalty" class="custom" />
                    <span>{terms.ignoresSustained}</span>
                </label>
            )}
        </div>
    );
}

/** The roll of a psychic power: an Arts spell's is tested on its skill. */
function PsychicPowerRoll({ path, close }: { path: string; close: () => void }) {
    const { state } = useSheet();
    const arts = useComputed(() => isArts(state, path)).value;
    return arts ? <ArtsRoll path={path} close={close} /> : <PsychicRoll path={path} close={close} />;
}

function PreparedLead({ path }: { path: string }) {
    const prepared = usePrepared(path);
    return prepared !== null ? <PreparedToggle prepared={prepared} /> : null;
}

function PsychicPills({ path }: { path: string }) {
    return (
        <>
            <ArtsChip path={path} />
            <SustainPill path={path} />
        </>
    );
}

function PsychicFields({ path }: { path: string }) {
    return (
        <>
            <div class="layout-row">
                <Row cls="subtypes" label={`${t("sheet.termsPowers.field.subtypes")}:`}><TextField field="subtypes" /></Row>
                <ArtsLevel path={path} />
                <Row cls="range" label={`${t("sheet.termsPowers.field.range")}:`}><TextField field="range" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="psychotest" label={`${t("common.test")}:`}><TextField field="psychotest" /></Row>
                <Row cls="action" label={`${t("sheet.termsPowers.field.action")}:`}><TextField field="action" /></Row>
                <Row cls="sustained" label={`${t("sheet.magic.profile.sustained")}:`}><TextField field="sustained" /></Row>
            </div>
        </>
    );
}

/** Sustained Powers: counted from the marked powers, or typed while the sheet does not count them. */
function SustainedPowersField() {
    const { state, terms } = useSheet();
    const counting = useComputed(() => psykanaRule(state, "sustained")).value;
    const counted = useComputed(() => sustainedPowers(state).taken);
    const label = `${terms.sustainedPowers}:`;
    if (!counting) return <label>{label} <NumberField field="sustainedPowers" class="short" /></label>;
    return (
        <label title={terms.sustainedCountedTitle}>{label}
            <ReadonlyField field="sustainedCount" value={counted} type="number" class="short textlike" />
        </label>
    );
}

/**
 * The Psykana tab; `bar` is what the kind adds under its PR, as the mana of
 * Pathfinder Crusade, and `ways` the rows of its other ways of casting, as
 * Arts. `spellcasting` is the row a kind whose casters tick their class
 * traits has in place of the Psykana type, first in the bar, and `prCap`
 * what it says of the base PR. The PR rows, `bar` with them, show while the
 * sheet casts by PR (showsPR); with `ways` they are a column beside them. It
 * has a path of its own: the PR bar is in the Scope of psykana only around
 * the fields of psykana.
 */
export function Psykana({ bar, ways, spellcasting, prCap }: {
    bar?: ComponentChildren; ways?: ComponentChildren; spellcasting?: ComponentChildren; prCap?: ComponentChildren;
}) {
    const { state, stats, terms } = useSheet();
    const prRows = useComputed(() => showsPR(state)).value;
    const pushes = useComputed(() => sheetPushes(state)).value;
    return (
        <>
            <PsykanaHeading />
            <div class="layout-column">
                <div id="pr-bar" class="layout-column centered-bar">
                    {spellcasting}
                    <div class="casting-ways">
                        <div class="layout-column centered-bar casting-way">
                            {ways && <span class="casting-way-label">{t("sheet.magicPf.ways.pr")}</span>}
                            {prRows && <Scope dataId="psykana" class="layout-column centered-bar">
                                <div class="layout-row">
                                    {!spellcasting && (
                                        <label>{`${terms.psykanaType}:`}
                                            <Select field="psykanaType" options={stats.psykanaTypes} />
                                        </label>
                                    )}
                                    {pushes && (
                                        <label>{`${t("sheet.termsPowers.psy.maxPush")}:`}
                                            <NumberField field="maxPush" class="short" />
                                        </label>
                                    )}
                                    <PhenomenaRoll />
                                </div>
                                <div class="layout-row">
                                    <label>{`${t("sheet.termsPowers.psy.basePR")}:`}
                                        <NumberField field="basePR" class="short" />
                                        {prCap}
                                    </label>
                                    <SustainedPowersField />
                                    <label>{`${t("sheet.termsPowers.psy.currentPR")}:`}
                                        <ReadonlyField field="effectivePR" type="number" class="short textlike" />
                                    </label>
                                </div>
                            </Scope>}
                            {prRows && bar}
                        </div>
                        {ways && (
                            <div class="layout-column centered-bar casting-way">
                                <span class="casting-way-label">{t("sheet.termsPf.magic.arts")}</span>
                                {ways}
                            </div>
                        )}
                    </div>
                    <Scope dataId="psykana" class="layout-column centered-bar">
                        <SustainedList />
                    </Scope>
                </div>
                <Scope dataId="psykana" class="layout-column">
                    <PowerTabs sort={PSYCHIC} />
                </Scope>
            </div>
        </>
    );
}

/** The psychic power at `powerPath` on `test`: the modifier and 5 per effective and kicked PR. */
function psychicTotal(state: SheetSignals, powerPath: string, test: string) {
    const rollPath = `${powerPath}.roll`;
    return baseAndExtras(state, rollPath, test, "psychic") + numberAt(state, `${rollPath}.modifier`) + 5 * numberAt(state, `${rollPath}.effectivePR`)
        + 5 * rollKick(state, powerPath);
}



export const POWER_FIELD: FieldOwner = {
    damage: POWER_DAMAGE,
    texts: {
        copyTitle: t("sheet.powers.field.copyTitle"),
        noSources: t("sheet.powers.field.noSources"),
        noExpression: { damage: t("sheet.powers.field.noExpression.damage"), pen: t("sheet.powers.field.noExpression.pen") },
    },
    label: t("sheet.termsPowers.psy.psychicPower.short"),
    stats: {
        damage: { own: t("sheet.magic.powerField.ownDamage"), placeholder: "1d10+2×PR", hint: t("sheet.magic.powerField.damageHint") },
        pen: { own: t("sheet.magic.powerField.ownPen"), placeholder: "PR", hint: t("sheet.magic.powerField.penHint") },
    },
    exprPlaceholder: "PR, W.b, 1d10",
    exprHelp: [t("sheet.magic.powerField.exprHelp")],
    own: (state, path, base) => t("sheet.magic.powerField.own", { base, pr: powerPR(state, path) }),
    // The total counts the PR even without modifiers.
    explainsOwn: true,
    Extra: CastPR,
};



function CastPR({ path }: { path: string }) {
    const { state } = useSheet();
    const cast = Number(valueAt(state, `${path}.cast.pr`)) || 0;
    const kick = Number(valueAt(state, `${path}.cast.kick`)) || 0;
    const cap = useComputed(() => uncastPR(state, path)).value;
    const note = cast <= 0 ? t("sheet.magic.castPR.uncast", { pr: cap })
        : valueAt(state, `${path}.cast.safe`) ? t("sheet.magic.castPR.safe")
            : kick > 0 ? t("sheet.magic.castPR.kick", { kick }) : t("sheet.magic.castPR.last");
    return (
        <label class="mod-base mod-pr" title={t("sheet.magic.castPR.title")}>
            <span class="column-label">PR</span>
            <Scope dataId="cast" as="span" class="mod-pr-field">
                <NumberField field="pr" />
            </Scope>
            <span class="mod-pr-note" data-id="prNote">{note}</span>
        </label>
    );
}

const PSYCHIC: PowerSort = {
    Roll: PsychicPowerRoll,
    Lead: PreparedLead,
    Traits: PowerTraits,
    Pill: PsychicPills,
    Fields: PsychicFields,
    field: POWER_FIELD,
    damageLabel: psychicDamageLabel,
    collection: "psychicPowers",
    // A picked spell is tested as its Magic test says; the option it names is added first, so the roll finds it.
    picked: ({ state, actions }, result, power) => {
        const arts = hasArts(state) && powerTraits(String(result.subtypes ?? ""), "").arts !== undefined;
        const { roll, option } = spellRollFromTest(state, String(result.psychotest ?? ""), arts);
        if (option) addTestOption(state, actions, option);
        return { ...power, roll: { ...power.roll, ...roll } };
    },
    newRoll: (state, defaults) => ({ ...defaults.psychicPower, testOption: firstTestOption(state, "psykana") }),
    prefix: "psychic-powers",
    itemClass: "psychic-power",
    tabGroup: "psykana-tabs",
};
