// The heading of Psykana with the ⚙ of its test options and of the rules the
// sheet counts for a psyker, and a one-time notice of them, none in the Magic tab of a kind with
// Spellcasting. The rules of casting by PR show while the sheet does (showsPR).
import { useComputed } from "@preact/signals";
import { t } from "../../i18n";
import { Signal } from "@preact/signals-core";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { resolvePath, valueAt } from "../core/sync";
import type { PsykanaTerms } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { showsPR } from "./artsRules";
import { hasSpellcasting } from "./spellcastingRules";
import { BlockHeading } from "../rolls/BlockSettings";
import type { Rule } from "../components/kindParts";

const psykanaRules = (terms: PsykanaTerms): readonly Rule[] => [
    { field: "sustained", label: terms.sustainedLabel, title: terms.sustainedRuleTitle },
    { field: "cycle", label: t("sheet.termsPowers.psyType.cycle"), title: terms.cycleRuleTitle },
    { field: "phenomena", label: t("sheet.magic.phenomena.rule"), title: terms.phenomenaRuleTitle },
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
    const { state, canEdit, actions, terms } = useSheet();
    const shown = useComputed(() => canEdit && !valueAt(state, "settings.psykana.noticeSeen") && hasPsykana(state)).value;
    const pr = useComputed(() => showsPR(state)).value;
    if (!shown || hasSpellcasting(state)) return null;
    const typed = Number(valueAt(state, "psykana.sustainedPowers")) || 0;
    return (
        <div class="psykana-notice" data-id="psykanaNotice">
            {pr && (
                <p data-id="prNotice">{terms.countsNotice}</p>
            )}
            {typed > 0 && !!valueAt(state, "settings.psykana.sustained") && (
                <p data-id="typedSustained">{terms.typedSustainedNotice(typed)}</p>
            )}
            <button type="button" class="button-colored" onClick={() => actions.change("settings.psykana.noticeSeen", true)}>{t("sheet.magic.notice.gotIt")}</button>
        </div>
    );
}

/** Rules of casting by PR alone, which the ⚙ shows only with the PR rows. */
const PR_RULES = ["cycle", "phenomena"];

export function PsykanaHeading() {
    const { state, terms, castCost, preparation } = useSheet();
    const pr = useComputed(() => showsPR(state)).value;
    const castOption = useComputed(() => hasSpellcasting(state)).value;
    const rules = [
        ...psykanaRules(terms).filter(rule => pr || !PR_RULES.includes(rule.field)),
        ...(castCost ? [castCost.rule] : []),
        ...(preparation ? [preparation.rule] : []),
    ];
    return (
        <BlockHeading level="h2" heading={terms.psykana} block="psykana" rolls={terms.rolls} rules={rules} castOption={castOption}
            title={terms.headingTitle}>
            <Scope dataId="settings">
                <Notice />
            </Scope>
        </BlockHeading>
    );
}
