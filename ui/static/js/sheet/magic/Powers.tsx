// Psykana: its bar over the tabs of psychic powers (powers/Powers.tsx), and
// what a psychic power has of its own.
import type { ComponentChildren } from "preact";
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
    ExtraModifier, RollResult, TestText, baseAndExtras, extraNames, rollLabel, useRollTest,
} from "../rolls/rollParts";

const int = (state: SheetSignals, path: string) => parseInt(String(peekAt(state, path)), 10) || 0;

/**
 * The effective PR of a psychic power's cast. Max casts it normally at the
 * current PR, Safe at half of it without a kick; bonuses are typed in.
 */
function EffectivePrColumn({ path, safe }: { path: string; safe: boolean }) {
    const { state, actions, terms } = useSheet();
    const rollPath = `${path}.roll`;
    const cap = useComputed(() => castCap(state, path)).value;
    const of = valueAt(state, `${path}.ignoreTprPenalty`) ? "the base PR (talent)" : "the current PR";
    return (
        <div class="roll-column pr-column effective-pr">
            <label class="column-label">Effective PR</label>
            <div class="roll-column-content">
                <NumberField field="effectivePR" />
                <div class="pr-buttons">
                    <button type="button" data-id="safePR" class={safe ? "pr-button active" : "pr-button"}
                        title={`Safe: ePR ${safePR(cap)}, half ${of} rounded up; no kick, no phenomena`}
                        onClick={() => actions.batch(rollPath, safe ? { safe: false } : { safe: true, effectivePR: safePR(cap), kickPR: 0 })}>
                        Safe
                    </button>
                    <button type="button" data-id="maxPR" class="pr-button" title={`Normal: ePR ${cap}, ${of}`}
                        onClick={() => actions.batch(rollPath, { safe: false, effectivePR: cap })}>
                        Max
                    </button>
                </div>
                {cap <= 0 && <span class="pr-warning" data-id="noPR">{`No PR left for a new ${terms.power}`}</span>}
            </div>
        </div>
    );
}

function KickColumn({ path, safe }: { path: string; safe: boolean }) {
    const { state, actions } = useSheet();
    const set = (value: number) => actions.change(`${path}.roll.kickPR`, value);
    return (
        <div class="roll-column pr-column kick" title={safe ? "A safe cast has no kick" : undefined}>
            <label class="column-label">Kick</label>
            <div class="roll-column-content">
                <NumberField field="kickPR" readOnly={safe} />
                <div class="pr-buttons">
                    <button type="button" data-id="kickZero" class="pr-button" disabled={safe} onClick={() => set(0)}>0</button>
                    <button type="button" data-id="kickMax" class="pr-button" disabled={safe}
                        onClick={() => set(int(state, "psykana.maxPush"))}>Max</button>
                </div>
            </div>
        </div>
    );
}

export function PsychicRoll({ path, close }: { path: string; close: () => void }) {
    const { state, actions, rolls, terms, canEdit, castCost, preparation } = useSheet();
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
        const name = String(peekAt(state, `${path}.name`) || `Unknown ${terms.Power}`);
        const effectivePR = int(state, `${rollPath}.effectivePR`);
        const kickPR = rollKick(state, path);
        const modifiers = [
            ...(safe ? ["safe"] : []),
            ...(effectivePR > 0 ? [`${effectivePR} ePR`] : []),
            ...(kickPR > 0 ? [`+${kickPR} kick`] : []),
            ...extraNames(state, rollPath),
        ];
        void castPower({ state, actions, rolls }, path, {
            effectivePR, kick: kickPR, safe,
            target: total.peek(), bonusSuccesses: rollBonusSuccesses(state, test.peek()), label: rollLabel(name, modifiers),
            sustain: choice && !choice.full && sustain.peek() ? { free: choice.canBeFree && free.peek() } : null,
            pay: castCost && (() => castCost.pay({ state, actions }, effectivePR + kickPR)),
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
                <RollRow label="Test" class="test-text-row">
                    <TestText text={testText} note={note === "mode" ? "Set the Modifier by the mode" : "Pick the test and the Modifier by it"} />
                </RollRow>
            )}
            {castCost && <castCost.Row cost={pr} />}
            {preparation && <preparation.Row path={path} />}
            {choice && <SustainColumn choice={choice} sustain={sustain} free={free} />}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={test.value === null || noPR || unpaid !== null}
                title={noPR ? "Set the effective PR, e.g. with Max or Safe" : unpaid ?? undefined} />
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
                title={`Traits and talents of the ${terms.power}`} onClick={dropdown.toggle}>⚙</button>
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
            <span class="column-label">From Subtypes and Sustained</span>
            <ul class="power-traits-list" data-id="traits">
                <li>{traits.sustainable ? "Can be sustained" : "Cannot be sustained"}</li>
                {traits.cycle !== undefined && (
                    <li>{`Cycle (${x(traits.cycle, "?")}): sustaining it may be free when cast at ePR ${x(traits.cycle, "X")} or more`}</li>
                )}
                {traits.upkeep !== undefined && (
                    <li>{`Upkeep (${x(traits.upkeep, "?")}): while sustained, it costs ${x(traits.upkeep, "X")} mana at the start of each turn, free by Cycle or not`}</li>
                )}
                {traits.repeatable !== undefined && (
                    <li>{`Repeatable (${x(traits.repeatable, "?")}): ${x(traits.repeatable, "X")} of its casts are sustained at once, those after them are not`}</li>
                )}
                <ArtsTrait path={path} />
            </ul>
            <SustainFields path={path} />
            {phenomenaShown && (
                <label class="power-traits-phenomena" title={`What the ${terms.power} adds to the phenomena of its casts`}>
                    Phenomena mod <NumberField field="phenomenaMod" class="short" />
                </label>
            )}
            {!arts && (
                <label class="power-traits-talent" title="Its casts count from the base PR rather than the current one">
                    <Checkbox field="ignoreTprPenalty" class="custom" />
                    <span>{`Talent: ignores the PR the sustained ${terms.powers} take`}</span>
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
                <Row cls="subtypes" label="Subtypes:"><TextField field="subtypes" /></Row>
                <ArtsLevel path={path} />
                <Row cls="range" label="Range:"><TextField field="range" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="psychotest" label="Test:"><TextField field="psychotest" /></Row>
                <Row cls="action" label="Action:"><TextField field="action" /></Row>
                <Row cls="sustained" label="Sustained:"><TextField field="sustained" /></Row>
            </div>
        </>
    );
}

/** Sustained Powers: counted from the marked powers, or typed while the sheet does not count them. */
function SustainedPowersField() {
    const { state, terms } = useSheet();
    const counting = useComputed(() => psykanaRule(state, "sustained")).value;
    const counted = useComputed(() => sustainedPowers(state).taken);
    const label = `Sustained ${terms.Powers}:`;
    if (!counting) return <label>{label} <NumberField field="sustainedPowers" class="short" /></label>;
    return (
        <label title={`Counted from the ${terms.powers} marked sustained; turn the counting off under ⚙ to type it`}>{label}
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
                            {ways && <span class="casting-way-label">Cast by PR</span>}
                            {prRows && <Scope dataId="psykana" class="layout-column centered-bar">
                                <div class="layout-row">
                                    {!spellcasting && (
                                        <label>{`${terms.psykanaType}:`}
                                            <Select field="psykanaType" options={stats.psykanaTypes} />
                                        </label>
                                    )}
                                    {pushes && (
                                        <label>Max Push:
                                            <NumberField field="maxPush" class="short" />
                                        </label>
                                    )}
                                    <PhenomenaRoll />
                                </div>
                                <div class="layout-row">
                                    <label>Base PR:
                                        <NumberField field="basePR" class="short" />
                                        {prCap}
                                    </label>
                                    <SustainedPowersField />
                                    <label>Current PR:
                                        <ReadonlyField field="effectivePR" type="number" class="short textlike" />
                                    </label>
                                </div>
                            </Scope>}
                            {prRows && bar}
                        </div>
                        {ways && (
                            <div class="layout-column centered-bar casting-way">
                                <span class="casting-way-label">Arts</span>
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
    noun: "power",
    label: "Power",
    stats: {
        damage: {
            own: "The power's own damage, as the rulebook gives it; PR is the PR of its cast",
            placeholder: "1d10+2×PR",
            hint: "Add W.b, PR, 1d10 or a number.",
        },
        pen: {
            own: "The power's own penetration, as the rulebook gives it; PR is the PR of its cast",
            placeholder: "PR",
            hint: "Add PR, bPR or a number.",
        },
    },
    exprPlaceholder: "PR, W.b, 1d10",
    exprHelp: ["PR — the PR of the cast; PRd10 — d10 as many"],
    own: (state, path, base) => `Power ${base}, PR ${powerPR(state, path)}`,
    // The total counts the PR even without modifiers.
    explainsOwn: true,
    Extra: CastPR,
};



function CastPR({ path }: { path: string }) {
    const { state } = useSheet();
    const cast = Number(valueAt(state, `${path}.cast.pr`)) || 0;
    const kick = Number(valueAt(state, `${path}.cast.kick`)) || 0;
    const cap = useComputed(() => uncastPR(state, path)).value;
    const note = cast <= 0 ? `No cast yet: PR ${cap} counts`
        : valueAt(state, `${path}.cast.safe`) ? "Of the last cast, safe"
            : kick > 0 ? `Of the last cast, +${kick} kick` : "Of the last cast";
    return (
        <label class="mod-base mod-pr" title="The PR the damage and penetration count. Lower it for this hit; the next cast sets it again.">
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
    damageLabel: (state, path, terms) =>
        `${String(peekAt(state, `${path}.name`) || terms.psychicPower)}, PR ${untracked(() => powerPR(state, path))}`,
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
