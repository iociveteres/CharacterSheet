// The roll of a Sorcery spell (state/sorcery.ts), in place of the PR roll of
// Powers.tsx: tested on a skill rather than a test option, its ePR capped by
// the level of that skill, no kick, no Safe, no phenomena; it pays its Level
// from the Sorcery pool. Its warnings never stop the roll: only a missing
// skill, with nothing to roll, and the mana do.
import type { ComponentChildren } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useSheet } from "../components/context";
import { NumberField, Select } from "../components/fields";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue } from "../schema/constants";
import { castPower } from "../state/cast";
import { manaRule } from "../state/mana";
import { rollBonusSuccesses } from "../state/rollBase";
import { sorceryCap, sorceryCost, sorceryRecast, sorceryTest, sorceryTotal } from "../state/sorcery";
import { numberAt, peekAt, textAt } from "../state/sync";
import { testBaseGroups, testBaseLabel } from "../state/testOptions";
import { RollRow } from "./Processes";
import { ExtraModifier, RollResult, extraNames, rollLabel } from "./rollParts";
import { SustainColumn, useSustainChoice } from "./Sustain";

/** The skill of the roll, by the groups of the test options without the characteristics, and the characteristic it is tested on. */
function SkillColumn({ rollPath }: { rollPath: string }) {
    const { state, stats } = useSheet();
    const skill = textAt(state, `${rollPath}.skill`);
    const groups = testBaseGroups(state, stats).filter(g => g.label !== "Characteristics");
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

/** The effective PR; Max sets the level of the skill, the most a cast can take. */
function EffectivePrColumn({ rollPath, max, source }: { rollPath: string; max: number; source: string }) {
    const { actions } = useSheet();
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
            </div>
        </div>
    );
}

function Warning({ id, children }: { id: string; children: ComponentChildren }) {
    return <span class="pr-warning" data-id={id}>{children}</span>;
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
            <EffectivePrColumn rollPath={rollPath} max={cap.max} source={cap.source} />
            {cap.skill && (
                <RollRow label="Skill level" class="skill-level-row">
                    <span data-id="capSource">{cap.source}</span>
                    {cap.max === 0 && <Warning id="untrained">{`${cap.skill} is not trained: a Sorcery ${terms.power} cannot be cast`}</Warning>}
                    {cap.hint && <Warning id="masteryHint">{cap.hint}</Warning>}
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
            <RollResult total={total} onRoll={roll} disabled={noSkill || unpaid !== null}
                title={noSkill ? "Pick the skill" : unpaid ?? undefined} />
        </Scope>
    );
}
