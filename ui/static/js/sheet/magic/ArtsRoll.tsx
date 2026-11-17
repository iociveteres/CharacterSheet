// The roll of an Arts spell (magic/artsRules.ts), in place of the PR roll of
// Powers.tsx: tested on a skill rather than a test option, its ePR capped by
// the level of that skill, no kick, no Safe, no phenomena; it pays its Level
// from the Focus of its class. The skills its Magic test names are offered as
// buttons (magic/magicTest.ts). Its warnings never stop the roll: only a
// skill not picked or gone from the sheet, with nothing to roll, and the
// Focus do.
import type { ComponentChildren } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { t } from "../../i18n";
import { useSheet } from "../components/context";
import { NumberField, Select } from "../components/fields";
import { Scope } from "../components/Scope";
import { optionLabel, optionValue } from "../schema/constants";
import { castPower } from "./cast";
import { magicTestChoices, type MagicTestChoices } from "./magicTest";
import { manaRule } from "./manaRules";
import { rollBonusSuccesses } from "../rolls/rollBase";
import { SKILL_LEVEL_LABELS, artsCap, artsClass, artsCost, artsPool, artsRecast, artsTest, artsTotal, type ArtsCap } from "./artsRules";
import { numberAt, peekAt, textAt } from "../core/sync";
import { testBaseLabel } from "../rolls/testOptionRules";
import { skillGroups } from "../characteristics/skillNames";
import { signed } from "../components/format";
import { RollRow, ExtraModifier, RollResult, TestText, extraNames, rollLabel } from "../rolls/rollParts";
import { testTextNote, type TestTextNote } from "./spellRoll";
import { SustainColumn, useSustainChoice } from "./Sustain";

/** The skill of the roll, by the groups of the test options, and the characteristic it is tested on. */
function SkillColumn({ rollPath }: { rollPath: string }) {
    const { state, stats } = useSheet();
    const skill = textAt(state, `${rollPath}.skill`);
    const groups = skillGroups(state, stats);
    const known = groups.some(g => g.options.some(o => optionValue(o) === skill));
    return (
        <div class="roll-column base">
            <label class="column-label">{t("sheet.terms.experienceType.skill")}</label>
            <div class="roll-column-content">
                <Select field="skill" class="arts-skill">
                    {!skill && <option value="">{t("sheet.magicPf.artsRoll.pickSkillOption")}</option>}
                    {skill && !known && <option value={skill}>{testBaseLabel(state, stats, skill)}</option>}
                    {groups.map(g => (
                        <optgroup key={g.label} label={g.label}>
                            {g.options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
                        </optgroup>
                    ))}
                </Select>
                <label class="modifier-label char-label">{`${t("sheet.magicPf.artsRoll.characteristic")}:`}</label>
                <Select field="characteristic" class="arts-characteristic" title={t("sheet.rolls.test.testedOn")}
                    options={[{ value: "", label: t("sheet.magicPf.artsRoll.skillOwn") }, ...stats.skillCharacteristics]} />
                <label class="modifier-label">{`${t("common.modifier")}:`}</label>
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
            <label class="column-label">{t("sheet.termsPowers.psy.effectivePR")}</label>
            <div class="roll-column-content">
                <NumberField field="effectivePR" />
                <div class="pr-buttons">
                    <button type="button" data-id="maxPR" class="pr-button" title={source ? t("sheet.magicPf.artsRoll.maxTitle", { max, source }) : t("sheet.magicPf.artsRoll.pickSkillFirst")}
                        onClick={() => actions.change(`${rollPath}.effectivePR`, max)}>
                        {t("sheet.magic.pr.max")}
                    </button>
                </div>
                {/* An untrained skill has its own warning. */}
                {max > 0 && epr > max && <Warning id="overMax">{t("sheet.magicPf.artsRoll.overMax", { skill, max })}</Warning>}
                {max > 0 && epr <= 0 && <Warning id="noEPR">{t("sheet.magicPf.artsRoll.noEPR", { max })}</Warning>}
            </div>
        </div>
    );
}

function Warning({ id, children }: { id: string; children: ComponentChildren }) {
    return <span class="pr-warning" data-id={id}>{children}</span>;
}

// Without its skill the test would be the modifier alone: nothing to roll.
const SKILL_LOST = t("sheet.magicPf.artsRoll.skillLost");

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
        <RollRow label={t("common.test")} class="test-choices-row">
            {note && <TestText text={text} note={note === "mode" ? t("sheet.magic.testText.mode") : t("sheet.magicPf.artsRoll.testTextUnread")} />}
            {choosing && (
                <div class="test-choices">
                    {choices.map(c => {
                        const on = c.skill === skill && c.characteristic === characteristic;
                        return (
                            <button key={`${c.skill} ${c.characteristic}`} type="button" data-id="testChoice" class={on ? "pr-button active" : "pr-button"}
                                aria-pressed={on} disabled={!canEdit} title={c.modifier
                                    ? t("sheet.magicPf.artsRoll.choiceTitleModifier", { skill: c.label, modifier: signed(c.modifier) })
                                    : t("sheet.magicPf.artsRoll.choiceTitle", { skill: c.label })}
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
            {choosing && !skill && missing.map(m => <Warning key={m} id="testMissing">{t("sheet.magicPf.artsRoll.pickYour", { skill: m })}</Warning>)}
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
        const name = String(peekAt(state, `${path}.name`) || terms.unknownPower);
        const effectivePR = numberAt(state, `${rollPath}.effectivePR`);
        const cost = artsCost(state, path);
        const test = artsTest(state, rollPath);
        void castPower({ state, actions, rolls }, path, {
            effectivePR, kick: 0, safe: false,
            target: total.peek(), bonusSuccesses: rollBonusSuccesses(state, test),
            label: rollLabel(name, [
                ...(effectivePR > 0 ? [t("sheet.magic.roll.effectivePR", { pr: effectivePR })] : []),
                ...(sustained.penalty ? [t("sheet.magicPf.artsRoll.twoSustained")] : []),
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
                <RollRow label={t("sheet.magicPf.artsRoll.skillLevel")} class="skill-level-row">
                    <span data-id="capSource">{cap.source}</span>
                    {cap.max === 0 && <Warning id="untrained">{t("sheet.magicPf.artsRoll.untrained", { skill: cap.skill })}</Warning>}
                    {cap.hint && <Warning id="masteryHint">{cap.hint}</Warning>}
                </RollRow>
            )}
            {cap.lost && (
                <RollRow label={t("sheet.magicPf.artsRoll.skillLevel")} class="skill-level-row">
                    <Warning id="skillLost">{SKILL_LOST}</Warning>
                </RollRow>
            )}
            {castCost && pool && <castCost.Row cost={level} pool={pool} />}
            {castCost && !pool && manaRule(state) && (
                <RollRow label={t("sheet.termsPf.magic.focus")} class="mana-row">
                    <Warning id="noFocus">{t("sheet.magicPf.artsRoll.noFocus", { class: artsClass(state, path) ?? "" })}</Warning>
                </RollRow>
            )}
            {manaRule(state) && pool && level <= 0 && (
                <RollRow label={t("sheet.magicPf.arts.level")} class="level-row">
                    <Warning id="noLevel">{t("sheet.magicPf.artsRoll.noLevel")}</Warning>
                </RollRow>
            )}
            {choice && (
                <SustainColumn choice={{ ...choice, cycle: undefined, canBeFree: false }} sustain={sustain} free={free}>
                    {overLimit && (
                        <Warning id="sustainLimit">
                            {t("sheet.magicPf.artsRoll.sustainLimit", { names: sustained.powers.map(p => p.name).join(", "), limit: sustained.limit })}
                        </Warning>
                    )}
                </SustainColumn>
            )}
            {sustained.penalty !== 0 && (
                <RollRow label={t("sheet.termsPowers.psy.sustained")} class="sustain-penalty-row">
                    <span data-id="sustainPenalty" title={t("sheet.magicPf.artsRoll.penaltyTitle")}>
                        {t("sheet.magicPf.artsRoll.penalty", { penalty: sustained.penalty })}
                    </span>
                </RollRow>
            )}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={noSkill || !!cap.lost || unpaid !== null}
                title={noSkill
                    ? (!test.choices.length && test.missing.length ? t("sheet.magicPf.artsRoll.pickYour", { skill: test.missing[0] }) : t("sheet.magicPf.artsRoll.pickSkill"))
                    : cap.lost ? SKILL_LOST : unpaid ?? undefined} />
        </Scope>
    );
}
