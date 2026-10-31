// The roll of an Arts spell (state/arts.ts), in place of the PR roll of
// Powers.tsx: tested on a skill rather than a test option, its ePR capped by
// the level of that skill, no kick, no Safe, no phenomena; it pays its Level
// from the Focus of its class. The skills its Magic test names are offered as
// buttons (state/magicTest.ts). Its warnings never stop the roll: only a
// skill not picked or gone from the sheet, with nothing to roll, and the
// Focus do.
import type { ComponentChildren } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useSheet } from "../components/context";
import { NumberField, Select } from "../components/fields";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue } from "../schema/constants";
import { castPower } from "../state/cast";
import { magicTestChoices, type MagicTestChoices } from "../state/magicTest";
import { manaRule } from "../state/mana";
import { rollBonusSuccesses } from "../state/rollBase";
import { SKILL_LEVEL_LABELS, artsCap, artsClass, artsCost, artsPool, artsRecast, artsTest, artsTotal, type ArtsCap } from "../state/arts";
import { numberAt, peekAt, textAt } from "../state/sync";
import { skillGroups, testBaseLabel } from "../state/testOptions";
import { signed } from "../system";
import { RollRow } from "./Processes";
import { ExtraModifier, RollResult, TestText, extraNames, rollLabel } from "./rollParts";
import { testTextNote, type TestTextNote } from "../state/spellRoll";
import { SustainColumn, useSustainChoice } from "./Sustain";

/** The skill of the roll, by the groups of the test options, and the characteristic it is tested on. */
function SkillColumn({ rollPath }: { rollPath: string }) {
    const { state, stats } = useSheet();
    const skill = textAt(state, `${rollPath}.skill`);
    const groups = skillGroups(state, stats);
    const known = groups.some(g => g.options.some(o => optionValue(o) === skill));
    return (
        <div class="roll-column base">
            <label class="column-label">Skill</label>
            <div class="roll-column-content">
                <Select field="skill" class="arts-skill">
                    {!skill && <option value="">(pick the skill)</option>}
                    {skill && !known && <option value={skill}>{testBaseLabel(state, stats, skill)}</option>}
                    {groups.map(g => (
                        <optgroup key={g.label} label={g.label}>
                            {g.options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
                        </optgroup>
                    ))}
                </Select>
                <label class="modifier-label char-label">Char:</label>
                <Select field="characteristic" class="arts-characteristic" title="Tested on"
                    options={[{ value: "", label: "Skill's own" }, ...stats.skillCharacteristics]} />
                <label class="modifier-label">Modifier:</label>
                <NumberField field="modifier" />
            </div>
        </div>
    );
}

/** The effective PR, with a warning past the level of the skill or at 0; Max sets the level, the most a cast can take. */
function EffectivePrColumn({ rollPath, cap: { max, skill, source } }: { rollPath: string; cap: ArtsCap }) {
    const { state, actions } = useSheet();
    const epr = numberAt(state, `${rollPath}.effectivePR`);
    return (
        <div class="roll-column pr-column effective-pr">
            <label class="column-label">Effective PR</label>
            <div class="roll-column-content">
                <NumberField field="effectivePR" />
                <div class="pr-buttons">
                    <button type="button" data-id="maxPR" class="pr-button" title={source ? `ePR ${max}: ${source}` : "Pick the skill first"}
                        onClick={() => actions.change(`${rollPath}.effectivePR`, max)}>
                        Max
                    </button>
                </div>
                {/* An untrained skill has its own warning. */}
                {max > 0 && epr > max && <Warning id="overMax">{`Above the Max of ${skill}: ${max}`}</Warning>}
                {max > 0 && epr <= 0 && <Warning id="noEPR">{`Set the ePR: Max is ${max}`}</Warning>}
            </div>
        </div>
    );
}

function Warning({ id, children }: { id: string; children: ComponentChildren }) {
    return <span class="pr-warning" data-id={id}>{children}</span>;
}

// Without its skill the test would be the modifier alone: nothing to roll.
const SKILL_LOST = "The skill picked is not on the sheet: pick another";

/**
 * The skills of the sheet the Magic test names, a button each that tests the
 * roll on it; the one picked is pressed. While none is picked, what the test
 * names that the sheet has no skill for. Shown while there is a choice to make,
 * and with the test as the book writes it while the roll is not set by it.
 */
function TestChoices({ rollPath, text, note, test }: { rollPath: string; text: string; note: TestTextNote; test: MagicTestChoices }) {
    const { state, actions, canEdit } = useSheet();
    const skill = textAt(state, `${rollPath}.skill`);
    const characteristic = textAt(state, `${rollPath}.characteristic`);
    const { choices, missing } = test;
    const choosing = choices.length >= 2 || (!skill && (choices.length > 0 || missing.length > 0));
    if (!choosing && !note) return null;
    return (
        <RollRow label="Test" class="test-choices-row">
            {note && <TestText text={text} note={note === "mode" ? "Set the Modifier by the mode" : "Pick the skill and the Modifier by it"} />}
            {choosing && (
                <div class="test-choices">
                    {choices.map(c => {
                        const on = c.skill === skill && c.characteristic === characteristic;
                        return (
                            <button key={`${c.skill} ${c.characteristic}`} type="button" data-id="testChoice" class={on ? "pr-button active" : "pr-button"}
                                aria-pressed={on} disabled={!canEdit} title={`Test the cast on ${c.label}${c.modifier ? ` at ${signed(c.modifier)}` : ""}`}
                                // The modifier of the alternative before, as the autocomplete set it, would stay otherwise.
                                onClick={() => actions.batch(rollPath, {
                                    skill: c.skill, characteristic: c.characteristic, ...(c.modifier !== null && { modifier: c.modifier }),
                                })}>
                                {`${c.label} ${SKILL_LEVEL_LABELS[c.level]}`}
                            </button>
                        );
                    })}
                </div>
            )}
            {choosing && !skill && missing.map(m => <Warning key={m} id="testMissing">{`Pick your ${m}`}</Warning>)}
        </RollRow>
    );
}

export function ArtsRoll({ path, close }: { path: string; close: () => void }) {
    const { state, actions, rolls, terms, canEdit, castCost } = useSheet();
    const rollPath = `${path}.roll`;
    const cap = useComputed(() => artsCap(state, path)).value;
    const sustain = useSignal(true);
    const total = useComputed(() => artsTotal(state, path, sustain.value));
    const sustained = useComputed(() => artsRecast(state, path, sustain.value)).value;
    const level = artsCost(state, path);
    const choice = useSustainChoice(path);
    // No Cycle for an Arts spell: nothing is cast free.
    const free = useSignal(false);
    const noSkill = !textAt(state, `${rollPath}.skill`);
    const testText = textAt(state, `${path}.psychotest`);
    const test = useComputed(() => magicTestChoices(state, textAt(state, `${path}.psychotest`))).value;
    const note = useComputed(() => testTextNote(state, textAt(state, `${path}.psychotest`), true)).value;
    // A class no Spellcasting variant names has no Focus: its casts pay nothing.
    const pool = useComputed(() => artsPool(state, path)).value;
    // A viewer's roll pays nothing, so what it lacks does not stop it.
    const unpaid = canEdit && castCost && pool ? castCost.shortage(state, level, pool) : null;
    const sustains = !!choice && !choice.full && sustain.value;
    const overLimit = sustains && sustained.count >= sustained.limit;
    const roll = () => {
        const name = String(peekAt(state, `${path}.name`) || `Unknown ${terms.Power}`);
        const effectivePR = numberAt(state, `${rollPath}.effectivePR`);
        const cost = artsCost(state, path);
        const test = artsTest(state, rollPath);
        void castPower({ state, actions, rolls }, path, {
            effectivePR, kick: 0, safe: false,
            target: total.peek(), bonusSuccesses: rollBonusSuccesses(state, test),
            label: rollLabel(name, [
                ...(effectivePR > 0 ? [`${effectivePR} ePR`] : []),
                ...(sustained.penalty ? ["two sustained"] : []),
                ...extraNames(state, rollPath),
            ]),
            sustain: choice && !choice.full && sustain.peek() ? { free: false } : null,
            pay: castCost && pool ? () => castCost.pay({ state, actions }, cost, pool) : undefined,
            arts: true,
        });
        close();
    };
    return (
        <Scope dataId="roll" class="roll-dropdown power-roll arts-roll visible">
            <SkillColumn rollPath={rollPath} />
            <EffectivePrColumn rollPath={rollPath} cap={cap} />
            <TestChoices rollPath={rollPath} text={testText} note={note} test={test} />
            {cap.skill && (
                <RollRow label="Skill level" class="skill-level-row">
                    <span data-id="capSource">{cap.source}</span>
                    {cap.max === 0 && <Warning id="untrained">{`${cap.skill} is not trained: an Arts ${terms.power} cannot be cast`}</Warning>}
                    {cap.hint && <Warning id="masteryHint">{cap.hint}</Warning>}
                </RollRow>
            )}
            {cap.lost && (
                <RollRow label="Skill level" class="skill-level-row">
                    <Warning id="skillLost">{SKILL_LOST}</Warning>
                </RollRow>
            )}
            {castCost && pool && <castCost.Row cost={level} pool={pool} />}
            {castCost && !pool && manaRule(state) && (
                <RollRow label="Focus" class="mana-row">
                    <Warning id="noFocus">{`No ${artsClass(state, path)} Focus: the cast pays nothing`}</Warning>
                </RollRow>
            )}
            {manaRule(state) && pool && level <= 0 && (
                <RollRow label="Level" class="level-row">
                    <Warning id="noLevel">Set the Level: it is the Focus cost</Warning>
                </RollRow>
            )}
            {choice && (
                <SustainColumn choice={{ ...choice, cycle: undefined, canBeFree: false }} sustain={sustain} free={free}>
                    {overLimit && (
                        <Warning id="sustainLimit">
                            {`Already sustaining ${sustained.powers.map(p => p.name).join(", ")}: the limit is ${sustained.limit}`}
                        </Warning>
                    )}
                </SustainColumn>
            )}
            {sustained.penalty !== 0 && (
                <RollRow label="Sustained" class="sustain-penalty-row">
                    <span data-id="sustainPenalty" title="Expanded Sustain: casting while two Arts spells are sustained">
                        {`${sustained.penalty}: two sustained`}
                    </span>
                </RollRow>
            )}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={noSkill || !!cap.lost || unpaid !== null}
                title={noSkill ? (!test.choices.length && test.missing.length ? `Pick your ${test.missing[0]}` : "Pick the skill")
                    : cap.lost ? SKILL_LOST : unpaid ?? undefined} />
        </Scope>
    );
}
