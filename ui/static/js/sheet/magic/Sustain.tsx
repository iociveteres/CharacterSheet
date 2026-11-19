// Sustained psychic powers (magic/psychic.ts): the choice in a power's roll
// dropdown, the mark on a sustained power, its fields under the power's ⚙
// and the list of them in the psykana bar. None of it shows while the sheet
// does not count sustained powers (settings.psykana.sustained).
import type { ComponentChildren } from "preact";
import { t } from "../../i18n";
import type { Signal } from "@preact/signals-core";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Checkbox, NumberField } from "../components/fields";
import { numberAt, valueAt } from "../core/sync";
import { Scope } from "../components/Scope";
import { sustainedShown } from "./manaRules";
import { powerTraitsAt, psykanaRule, rollKick, type SustainedPower } from "./psychic";

/** What a cast of the power at `path` can do to its sustaining, as the roll dropdown offers it. */
export function useSustainChoice(path: string) {
    const { state } = useSheet();
    return useComputed(() => {
        const traits = powerTraitsAt(state, path);
        if (!psykanaRule(state, "sustained") || !traits.sustainable) return null;
        const copies = numberAt(state, `${path}.sustain.copies`);
        const full = traits.repeatable !== undefined && copies >= (traits.repeatable ?? 1);
        const pr = numberAt(state, `${path}.roll.effectivePR`) + rollKick(state, path);
        const cycle = psykanaRule(state, "cycle") ? traits.cycle : undefined;
        return {
            repeatable: traits.repeatable,
            copies,
            /** A Repeatable power with all its copies sustained: this cast is instant. */
            full,
            /** Cycle (X), when the sheet counts it; null for Cycle without X. */
            cycle,
            /** Whether this cast may be sustained free: Cycle without X, or cast at ePR X or more. */
            canBeFree: cycle !== undefined && (cycle === null || pr >= cycle),
        };
    }).value;
}

export type SustainChoice = NonNullable<ReturnType<typeof useSustainChoice>>;

/** The column of a psychic power's roll dropdown: sustain the cast once it succeeds, and free by Cycle; `children` are its warnings. */
export function SustainColumn({ choice, sustain, free, children }: {
    choice: SustainChoice; sustain: Signal<boolean>; free: Signal<boolean>; children?: ComponentChildren;
}) {
    const { terms } = useSheet();
    const x = (n: number | null | undefined) => (n === null || n === undefined ? "X" : String(n));
    return (
        <div class="roll-column sustain-column" data-id="sustainChoice">
            <label class="column-label">{t("sheet.termsPowers.psy.sustain")}</label>
            <div class="roll-column-content">
                {choice.full ? (
                    <span class="sustain-note" data-id="instant">
                        {t("sheet.magic.sustain.instant", { copies: choice.copies, x: x(choice.repeatable) })}
                    </span>
                ) : (
                    <label class="sustain-option" title={terms.marksSustainedTitle}>
                        <input type="checkbox" class="custom" data-id="sustain" checked={sustain.value}
                            onChange={e => { sustain.value = e.currentTarget.checked; }} />
                        {t("sheet.magic.sustain.onSuccess")}
                    </label>
                )}
                {!choice.full && choice.cycle !== undefined && (
                    <label class="sustain-option"
                        title={choice.canBeFree ? t("sheet.magic.sustain.freeTitle") : t("sheet.magic.sustain.freeFrom", { x: x(choice.cycle) })}>
                        <input type="checkbox" class="custom" data-id="free" disabled={!choice.canBeFree || !sustain.value}
                            checked={choice.canBeFree && free.value} onChange={e => { free.value = e.currentTarget.checked; }} />
                        {t("sheet.magic.sustain.freeByCycle", { x: x(choice.cycle) })}
                    </label>
                )}
                {children}
            </div>
        </div>
    );
}

// The upkeep only while casts spend mana (Pathfinder Crusade). An Arts spell takes no PR: its ePR is the cast's, and it pays its Focus.
const pillText = ({ copies, pr, free, upkeep, arts }: SustainedPower, upkeepShown: boolean) =>
    `${copies > 1 ? `×${copies} · ` : ""}${arts ? t("sheet.termsPowers.psy.ePR") : "PR"} ${pr}${free ? ` · ${t("sheet.magic.sustain.pill.freeMark")}` : ""}`
    + `${upkeepShown && upkeep > 0 ? ` · ${arts ? t("sheet.magicPf.mana.pillUpkeepFocus", { upkeep }) : t("sheet.magicPf.mana.pillUpkeep", { upkeep })}` : ""}`;

// Short enough for the header; the psykana bar says why a free one takes PR.
const pillTitle = ({ free, overFree, arts }: SustainedPower) =>
    arts ? t("sheet.magicPf.arts.pillTitle")
        : free ? t("sheet.magic.sustain.pill.free")
            : overFree ? t("sheet.magic.sustain.pill.overFree")
                : t("sheet.magic.sustain.pill.taken");

/** Ends one sustained cast of the power at `path`. */
function DropButton({ power }: { power: SustainedPower }) {
    const { canEdit, actions } = useSheet();
    if (!canEdit) return null;
    return (
        <button type="button" class="sustain-drop" data-id="dropSustain"
            title={power.copies > 1 ? t("sheet.magic.sustain.dropOne") : t("sheet.magic.sustain.drop")}
            onClick={() => actions.batch(`${power.path}.sustain`, { copies: power.copies - 1 })}>✕</button>
    );
}

/** The sustained spells of both ways (magic/artsRules.ts), while the sheet counts them. */
function useSustained() {
    const { state } = useSheet();
    return sustainedShown(state);
}

/** The mark of a sustained power in its header. */
export function SustainPill({ path }: { path: string }) {
    const sustained = useSustained();
    const power = sustained?.powers.find(p => p.path === path);
    if (!power) return null;
    return (
        <span class="sustain-pill" data-id="sustainPill" title={pillTitle(power)}>
            <span class="sustain-text">{t("sheet.magic.sustain.pill.text", { text: pillText(power, sustained!.upkeepShown) })}</span>
            <DropButton power={power} />
        </span>
    );
}

/**
 * The sustained powers in the psykana bar; a name opens its tab, unless not
 * `linked`, as in the stat block, which has no tabs. Its row is there when
 * empty too, so marking one moves nothing.
 */
export function SustainedList({ linked = true }: { linked?: boolean }) {
    const { ui } = useSheet();
    const sustained = useSustained();
    if (!sustained) return null;
    const tabs = ui.selectedTabSignal("psykana.tabs.items");
    return (
        <div class="layout-row sustained-list" data-id="sustainedList">
            {sustained.powers.map(power => (
                <span key={power.path} class="sustain-pill" title={pillTitle(power)}>
                    {linked ? (
                        <button type="button" class="sustain-name" title={t("sheet.magic.sustain.openTab")} onClick={() => { tabs.value = power.tabId; }}>
                            {power.name}
                        </button>
                    ) : <b>{power.name}</b>}
                    <span class="sustain-text">{pillText(power, sustained.upkeepShown)}</span>
                    <DropButton power={power} />
                </span>
            ))}
            {sustained.powers.some(p => p.overFree) && (
                <span class="sustain-warning" data-id="freeLimit">
                    {t("sheet.magic.sustain.freeLimit", { n: sustained.freeLimit })}
                </span>
            )}
        </div>
    );
}

/**
 * The sustaining of a power under its ⚙, to set by hand: sustained or not,
 * or how many casts for a Repeatable (X) power, the only one that holds more.
 */
export function SustainFields({ path }: { path: string }) {
    const { state, canEdit, actions } = useSheet();
    const shown = useComputed(() => psykanaRule(state, "sustained")).value;
    const traits = useComputed(() => powerTraitsAt(state, path)).value;
    const cycle = useComputed(() => psykanaRule(state, "cycle") && traits.cycle !== undefined).value;
    if (!shown) return null;
    const of = traits.repeatable === null ? "X" : String(traits.repeatable);
    return (
        <Scope dataId="sustain" class="power-traits-sustain">
            {traits.repeatable === undefined ? (
                <label title={t("sheet.magic.sustain.markedTitle")}>
                    <input type="checkbox" class="custom" data-id="marked" disabled={!canEdit} checked={numberAt(state, `${path}.sustain.copies`) > 0}
                        onChange={e => actions.batch(`${path}.sustain`, e.currentTarget.checked
                            // Marked by hand, it keeps the PR it has, else that of its last cast.
                            ? { copies: 1, pr: numberAt(state, `${path}.sustain.pr`) || numberAt(state, `${path}.cast.pr`) }
                            : { copies: 0 })} />
                    {t("sheet.termsPowers.psy.sustained")}
                </label>
            ) : (
                <label title={t("sheet.magic.sustain.copiesTitle", { x: of })}>
                    {t("sheet.magic.sustain.copies", { x: of })} <NumberField field="copies" class="short" />
                </label>
            )}
            <label title={t("sheet.magic.sustain.prTitle")}>{t("sheet.magic.sustain.at")} <NumberField field="pr" class="short" /> PR</label>
            {cycle && <label title={t("sheet.magic.sustain.castFreeTitle")}><Checkbox field="free" class="custom" /> {t("sheet.magic.sustain.freeLabel")}</label>}
        </Scope>
    );
}
