// The roll of a Sorcery spell (state/sorcery.ts), in place of the PR roll of
// Powers.tsx: tested on a skill rather than a test option, its ePR capped by
// the level of that skill, no kick, no Safe, no phenomena; it pays its Level
// from the Sorcery pool. The skills its Magic test names are offered as
// buttons (state/magicTest.ts). Its warnings never stop the roll: only a
// skill not picked or gone from the sheet, with nothing to roll, and the
// mana do.
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
import { SKILL_LEVEL_LABELS, sorceryCap, sorceryCost, sorceryRecast, sorceryTest, sorceryTotal, type SorceryCap } from "../state/sorcery";
import { numberAt, peekAt, textAt } from "../state/sync";
import { skillGroups, testBaseLabel } from "../state/testOptions";
import { signed } from "../system";
import { RollRow } from "./Processes";
import { ExtraModifier, RollResult, extraNames, rollLabel } from "./rollParts";
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
                <Select field="skill" class="sorcery-skill">
                    {!skill && <option value="">(pick the skill)</option>}
                    {skill && !known && <option value={skill}>{testBaseLabel(state, stats, skill)}</option>}
                    {groups.map(g => (
                        <optgroup key={g.label} label={g.label}>
                            {g.options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
                        </optgroup>
                    ))}
                </Select>
                <label class="modifier-label char-label">Char:</label>
                <Select field="characteristic" class="sorcery-characteristic" title="Tested on"
                    options={[{ value: "", label: "Skill's own" }, ...stats.skillCharacteristics]} />
                <label class="modifier-label">Modifier:</label>
                <NumberField field="modifier" />
            </div>
        </div>
    );
}

/** The effective PR, with a warning past the level of the skill; Max sets the level, the most a cast can take. */
function EffectivePrColumn({ rollPath, cap: { max, skill, source } }: { rollPath: string; cap: SorceryCap }) {
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
 * names that the sheet has no skill for. Shown while there is a choice to make.
 */
function TestChoices({ rollPath, test }: { rollPath: string; test: MagicTestChoices }) {
    const { state, actions, canEdit } = useSheet();
    const skill = textAt(state, `${rollPath}.skill`);
    const characteristic = textAt(state, `${rollPath}.characteristic`);
    const { choices, missing } = test;
    if (choices.length < 2 && (skill || (!choices.length && !missing.length))) return null;
    return (
        <RollRow label="Test" class="test-choices-row">
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
            {!skill && missing.map(m => <Warning key={m} id="testMissing">{`Pick your ${m}`}</Warning>)}
        </RollRow>
    );
}

export function SorceryRoll({ path, close }: { path: string; close: () => void }) {
    const { state, actions, rolls, terms, canEdit, castCost } = useSheet();
    const rollPath = `${path}.roll`;
    const cap = useComputed(() => sorceryCap(state, path)).value;
    const total = useComputed(() => sorceryTotal(state, path));
    const sustained = useComputed(() => sorceryRecast(state, path)).value;
    const level = sorceryCost(state, path);
    const choice = useSustainChoice(path);
    const sustain = useSignal(true);
    // No Cycle for a Sorcery spell: nothing is cast free.
    const free = useSignal(false);
    const noSkill = !textAt(state, `${rollPath}.skill`);
    const test = useComputed(() => magicTestChoices(state, path)).value;
    // A viewer's roll pays nothing, so what it lacks does not stop it.
    const unpaid = canEdit && castCost ? castCost.shortage(state, level, "sorceryMana") : null;
    const sustains = !!choice && !choice.full && sustain.value;
    const overLimit = sustains && sustained.count >= sustained.limit;
    const roll = () => {
        const name = String(peekAt(state, `${path}.name`) || `Unknown ${terms.Power}`);
        const effectivePR = numberAt(state, `${rollPath}.effectivePR`);
        const cost = sorceryCost(state, path);
        const test = sorceryTest(state, rollPath);
        void castPower({ state, actions, rolls }, path, {
            effectivePR, kick: 0, safe: false,
            target: total.peek(), bonusSuccesses: rollBonusSuccesses(state, test),
            label: rollLabel(name, [
                ...(effectivePR > 0 ? [`${effectivePR} ePR`] : []),
                ...(sustained.penalty ? ["two sustained"] : []),
                ...extraNames(state, rollPath),
            ]),
            sustain: choice && !choice.full && sustain.peek() ? { free: false } : null,
            pay: castCost && (() => castCost.pay({ state, actions }, cost, "sorceryMana")),
            sorcery: true,
        });
        close();
    };
    return (
        <Scope dataId="roll" class="roll-dropdown power-roll sorcery-roll visible">
            <SkillColumn rollPath={rollPath} />
            <EffectivePrColumn rollPath={rollPath} cap={cap} />
            <TestChoices rollPath={rollPath} test={test} />
            {cap.skill && (
                <RollRow label="Skill level" class="skill-level-row">
                    <span data-id="capSource">{cap.source}</span>
                    {cap.max === 0 && <Warning id="untrained">{`${cap.skill} is not trained: a Sorcery ${terms.power} cannot be cast`}</Warning>}
                    {cap.hint && <Warning id="masteryHint">{cap.hint}</Warning>}
                </RollRow>
            )}
            {cap.lost && (
                <RollRow label="Skill level" class="skill-level-row">
                    <Warning id="skillLost">{SKILL_LOST}</Warning>
                </RollRow>
            )}
            {castCost && <castCost.Row cost={level} pool="sorceryMana" />}
            {manaRule(state) && level <= 0 && (
                <RollRow label="Level" class="level-row">
                    <Warning id="noLevel">Set the Level: it is the mana cost</Warning>
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
                    <span data-id="sustainPenalty" title="Expanded Sustain: casting while two Sorcery spells are sustained">
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
