// Sustained psychic powers (state/psychic.ts): the choice in a power's roll
// dropdown, the mark on a sustained power, its fields under the power's ⚙
// and the list of them in the psykana bar. None of it shows while the sheet
// does not count sustained powers (settings.psykana.sustained).
import type { Signal } from "@preact/signals-core";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Checkbox, NumberField, valueAt } from "../components/fields";
import { Scope } from "../components/Scope";
import { selectedTabSignal } from "../state/ui";
import { powerTraitsAt, psykanaRule, sustainedPowers, type SustainedPower } from "../state/psychic";

const num = (path: string) => Number(valueAt(path)) || 0;

/** What a cast of the power at `path` can do to its sustaining, as the roll dropdown offers it. */
export function useSustainChoice(path: string) {
    return useComputed(() => {
        const traits = powerTraitsAt(path);
        if (!psykanaRule("sustained") || !traits.sustainable) return null;
        const copies = num(`${path}.sustain.copies`);
        const full = traits.repeatable !== undefined && copies >= (traits.repeatable ?? 1);
        const pr = num(`${path}.roll.effectivePR`) + (valueAt(`${path}.roll.safe`) ? 0 : num(`${path}.roll.kickPR`));
        const cycle = psykanaRule("cycle") ? traits.cycle : undefined;
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

/** The column of a psychic power's roll dropdown: sustain the cast once it succeeds, and free by Cycle. */
export function SustainColumn({ choice, sustain, free }: { choice: SustainChoice; sustain: Signal<boolean>; free: Signal<boolean> }) {
    const x = (n: number | null | undefined) => (n === null || n === undefined ? "X" : String(n));
    return (
        <div class="roll-column sustain-column" data-id="sustainChoice">
            <label class="column-label">Sustain</label>
            <div class="roll-column-content">
                {choice.full ? (
                    <span class="sustain-note" data-id="instant">
                        {`Instant: ${choice.copies} of Repeatable (${x(choice.repeatable)}) sustained`}
                    </span>
                ) : (
                    <label class="sustain-option" title="Marks the power sustained if the test succeeds">
                        <input type="checkbox" class="custom" data-id="sustain" checked={sustain.value}
                            onChange={e => { sustain.value = e.currentTarget.checked; }} />
                        On success
                    </label>
                )}
                {!choice.full && choice.cycle !== undefined && (
                    <label class="sustain-option"
                        title={choice.canBeFree ? "Sustaining it takes no PR" : `Free from ePR ${x(choice.cycle)}`}>
                        <input type="checkbox" class="custom" data-id="free" disabled={!choice.canBeFree || !sustain.value}
                            checked={choice.canBeFree && free.value} onChange={e => { free.value = e.currentTarget.checked; }} />
                        {`Free (Cycle ${x(choice.cycle)})`}
                    </label>
                )}
            </div>
        </div>
    );
}

const pillText = ({ copies, pr, free }: SustainedPower) => `${copies > 1 ? `×${copies} · ` : ""}PR ${pr}${free ? " · free" : ""}`;

// Short enough for the header; the psykana bar says why a free one takes PR.
const pillTitle = ({ free, overFree }: SustainedPower) =>
    free ? "Free by Cycle: it takes no PR"
        : overFree ? "Cast free by Cycle, but past the free ones ½I.b▲ allows: it takes PR"
            : "It takes one PR per sustained cast";

/** Ends one sustained cast of the power at `path`. */
function DropButton({ power }: { power: SustainedPower }) {
    const { canEdit, actions } = useSheet();
    if (!canEdit) return null;
    return (
        <button type="button" class="sustain-drop" data-id="dropSustain"
            title={power.copies > 1 ? "Stop sustaining one of its casts" : "Stop sustaining it"}
            onClick={() => actions.batch(`${power.path}.sustain`, { copies: power.copies - 1 })}>✕</button>
    );
}

const useSustained = () => useComputed(() => (psykanaRule("sustained") ? sustainedPowers() : null)).value;

/** The mark of a sustained power in its header. */
export function SustainPill({ path }: { path: string }) {
    const power = useSustained()?.powers.find(p => p.path === path);
    if (!power) return null;
    return (
        <span class="sustain-pill" data-id="sustainPill" title={pillTitle(power)}>
            <span class="sustain-text">{`Sustained ${pillText(power)}`}</span>
            <DropButton power={power} />
        </span>
    );
}

/** The sustained powers in the psykana bar; a name opens its tab. Its row is there when empty too, so marking one moves nothing. */
export function SustainedList() {
    const sustained = useSustained();
    if (!sustained) return null;
    const tabs = selectedTabSignal("psykana.tabs.items");
    return (
        <div class="layout-row sustained-list" data-id="sustainedList">
            {sustained.powers.map(power => (
                <span key={power.path} class="sustain-pill" title={pillTitle(power)}>
                    <button type="button" class="sustain-name" title="Open its tab" onClick={() => { tabs.value = power.tabId; }}>
                        {power.name}
                    </button>
                    <span class="sustain-text">{pillText(power)}</span>
                    <DropButton power={power} />
                </span>
            ))}
            {sustained.powers.some(p => p.overFree) && (
                <span class="sustain-warning" data-id="freeLimit">
                    {`Cycle sustains at most ${sustained.freeLimit} free (½I.b▲); the rest take PR.`}
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
    const { canEdit, actions } = useSheet();
    const shown = useComputed(() => psykanaRule("sustained")).value;
    const traits = useComputed(() => powerTraitsAt(path)).value;
    const cycle = useComputed(() => psykanaRule("cycle") && traits.cycle !== undefined).value;
    if (!shown) return null;
    const of = traits.repeatable === null ? "X" : String(traits.repeatable);
    return (
        <Scope dataId="sustain" class="power-traits-sustain">
            {traits.repeatable === undefined ? (
                <label title="Marked sustained: it takes one PR">
                    <input type="checkbox" class="custom" data-id="marked" disabled={!canEdit} checked={num(`${path}.sustain.copies`) > 0}
                        onChange={e => actions.batch(`${path}.sustain`, e.currentTarget.checked
                            // Marked by hand, it keeps the PR it has, else that of its last cast.
                            ? { copies: 1, pr: num(`${path}.sustain.pr`) || num(`${path}.cast.pr`) }
                            : { copies: 0 })} />
                    Sustained
                </label>
            ) : (
                <label title={`How many of its casts are sustained, up to ${of}; each takes one PR`}>
                    {`Sustained casts (of ${of})`} <NumberField field="copies" class="short" />
                </label>
            )}
            <label title="The PR of its sustained cast">PR <NumberField field="pr" class="short" /></label>
            {cycle && <label title="Cast free by Cycle: it takes no PR"><Checkbox field="free" class="custom" /> Free</label>}
        </Scope>
    );
}
