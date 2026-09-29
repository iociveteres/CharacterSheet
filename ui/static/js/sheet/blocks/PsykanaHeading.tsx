// The heading of Psykana with the ⚙ of the rules the sheet counts for a
// psyker, and a one-time notice of them. The settings are the sheet's
// (settings.psykana), so everyone who opens it sees the same numbers.
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { Signal } from "@preact/signals-core";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox } from "../components/fields";
import { Scope } from "../components/Scope";
import { resolvePath, valueAt } from "../state/sync";

const RULES = [
    {
        field: "sustained",
        label: "Sustained powers",
        title: "The Current PR drops by one for each power marked sustained; Sustained Powers is counted, not typed.",
    },
    {
        field: "cycle",
        label: "Cycle",
        title: "A Cycle (X) power cast at ePR X or more may be sustained without taking PR, at most ½I.b▲ of them.",
    },
    {
        field: "phenomena",
        label: "Phenomena roll",
        title: "A Phenomena button rolls d100 with the kick of the last cast, the sustained powers and other modifiers.",
    },
] as const;

function Settings() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <div class="psykana-settings dropdown-parent" ref={ref}>
            <button type="button" class={dropdown.open ? "psykana-settings-toggle active" : "psykana-settings-toggle"}
                title="What the sheet counts for a psyker" onClick={dropdown.toggle}>⚙</button>
            {dropdown.open && (
                <div class="roll-dropdown psykana-settings-dropdown visible">
                    <span class="column-label">The sheet counts</span>
                    {RULES.map(rule => (
                        <label key={rule.field} class="psykana-rule" title={rule.title}>
                            <Checkbox field={rule.field} class="custom" />
                            <span>
                                <span class="psykana-rule-label">{rule.label}</span>
                                <span class="psykana-rule-text">{rule.title}</span>
                            </span>
                        </label>
                    ))}
                    <span class="psykana-settings-note">These are the sheet's: everyone who opens it sees the same.</span>
                </div>
            )}
        </div>
    );
}

/** Whether the sheet has anything of a psyker: a base PR or a power. */
function hasPsykana(): boolean {
    if (Number(valueAt("psykana.basePR")) > 0) return true;
    const tabs = resolvePath("psykana.tabs.items");
    if (!tabs || tabs instanceof Signal || typeof tabs !== "object") return false;
    return Object.keys(tabs).some(id => {
        const powers = resolvePath(`psykana.tabs.items.${id}.powers.items`);
        return !!powers && !(powers instanceof Signal) && typeof powers === "object" && Object.keys(powers).length > 0;
    });
}

/** Tells a psyker's sheet once what it counts and where to turn it off. */
function Notice() {
    const { canEdit, actions } = useSheet();
    const shown = useComputed(() => canEdit && !valueAt("settings.psykana.noticeSeen") && hasPsykana()).value;
    if (!shown) return null;
    const typed = Number(valueAt("psykana.sustainedPowers")) || 0;
    return (
        <div class="psykana-notice" data-id="psykanaNotice">
            <p>
                The sheet now counts some psykana rules: the powers marked sustained lower the Current PR,
                Cycle powers can be sustained without taking PR, and a Phenomena button rolls with the kick
                and the sustained powers. Turn any of them off under ⚙ next to the heading.
            </p>
            {typed > 0 && !!valueAt("settings.psykana.sustained") && (
                <p data-id="typedSustained">
                    {`Sustained Powers was typed as ${typed}. It now counts the powers marked sustained: mark them, or turn the counting off.`}
                </p>
            )}
            <button type="button" class="button-colored" onClick={() => actions.change("settings.psykana.noticeSeen", true)}>Got it</button>
        </div>
    );
}

export function PsykanaHeading() {
    return (
        <div class="psykana-heading-block">
            <div class="psykana-heading">
                <h2>Psykana</h2>
                <Scope dataId="settings" as="span">
                    <Scope dataId="psykana" as="span">
                        <Settings />
                    </Scope>
                </Scope>
            </div>
            <Scope dataId="settings">
                <Notice />
            </Scope>
        </div>
    );
}
