// The headings of Psykana and Techno Arcana with the ⚙ of their test options
// and of the rules the sheet counts for a psyker or a tech-priest, and a
// one-time notice of the psyker's.
import { useComputed } from "@preact/signals";
import { Signal } from "@preact/signals-core";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { resolvePath, valueAt } from "../state/sync";
import type { SheetSignals } from "../schema/sheet";
import { BlockHeading, type Rule } from "./BlockSettings";

const PSYKANA_RULES: readonly Rule[] = [
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
];

const TECHNO_RULES: readonly Rule[] = [
    {
        field: "price",
        label: "Price",
        title: "Activating a tech power spends its ⚙ before the test and its 🗲 once it succeeds; without the ⚙ it is not rolled.",
    },
    {
        field: "processes",
        label: "Processes",
        title: "A successful activation holds the power in a Process, listed with what the Processes cost a turn.",
    },
    {
        field: "hardware",
        label: "Hardware",
        title: "The worst quality of the implants a power needs changes its test and its I: Poor −10, Good +5, Best +10.",
    },
];

/** Whether the sheet has anything of a psyker: a base PR or a power. */
function hasPsykana(state: SheetSignals): boolean {
    if (Number(valueAt(state, "psykana.basePR")) > 0) return true;
    const tabs = resolvePath(state, "psykana.tabs.items");
    if (!tabs || tabs instanceof Signal || typeof tabs !== "object") return false;
    return Object.keys(tabs).some(id => {
        const powers = resolvePath(state, `psykana.tabs.items.${id}.powers.items`);
        return !!powers && !(powers instanceof Signal) && typeof powers === "object" && Object.keys(powers).length > 0;
    });
}

/** Tells a psyker's sheet once what it counts and where to turn it off. */
function Notice() {
    const { state, canEdit, actions } = useSheet();
    const shown = useComputed(() => canEdit && !valueAt(state, "settings.psykana.noticeSeen") && hasPsykana(state)).value;
    if (!shown) return null;
    const typed = Number(valueAt(state, "psykana.sustainedPowers")) || 0;
    return (
        <div class="psykana-notice" data-id="psykanaNotice">
            <p>
                The sheet now counts some psykana rules: the powers marked sustained lower the Current PR,
                Cycle powers can be sustained without taking PR, and a Phenomena button rolls with the kick
                and the sustained powers. Turn any of them off under ⚙ next to the heading.
            </p>
            {typed > 0 && !!valueAt(state, "settings.psykana.sustained") && (
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
        <BlockHeading level="h2" heading="Psykana" block="psykana" rolls="Powers" rules={PSYKANA_RULES}
            title="Test options and what the sheet counts for a psyker">
            <Scope dataId="settings">
                <Notice />
            </Scope>
        </BlockHeading>
    );
}

export function TechnoArcanaHeading() {
    return (
        <BlockHeading level="h2" heading="Techno Arcana" block="technoArcana" rolls="Powers" rules={TECHNO_RULES}
            title="Test options and what the sheet counts for a tech-priest" />
    );
}
