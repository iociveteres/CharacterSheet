// The result of a chat command drawn from its data (internal/commands/result_data.go)
// in the viewer's language. In English it is, to the letter, the text the server
// stores as commandResult, which messages without data show.
import { t } from "../i18n";
import type { ResultData, VersusRoll } from "./commands.gen";
import type { VersusOutcome } from "./messages";

function outcomeOf(roll: VersusRoll): string {
    const degrees = roll.success ? t("room.roll.success", { count: roll.degrees }) : t("room.roll.fail", { count: roll.degrees });
    return roll.crit ? `${degrees}, ${t("room.roll.crit")}` : degrees;
}

/** The text of the result; null for a kind this client does not know, which shows commandResult instead. */
export function renderResult(data: ResultData): string | null {
    if (data.kind !== "versus") return null;
    // "vs" and "[+N]" are the syntax of the command, not words.
    const test = data.bonus ? `${data.expression} vs ${data.target} [+${data.bonus}]` : `${data.expression} vs ${data.target}`;
    if (!data.repeat) {
        const roll = data.rolls[0];
        const lines = [`${test}:`];
        if (roll.output) lines.push(`${roll.output} = ${roll.roll}`);
        lines.push(`${roll.roll}, ${outcomeOf(roll)}`);
        return lines.join("\n");
    }
    const total = data.total ?? 0;
    const sum = data.rolls.map(r => (r.success ? `${r.degrees}` : `-${r.degrees}`)).join(" + ").replaceAll("+ -", "- ");
    return [
        `${data.repeat}x(${test}):`,
        ...data.rolls.map(r => `${r.output ? `${r.output} = ${r.roll}` : r.roll}, ${outcomeOf(r)}`),
        `${sum} = ${total}`,
        total < 0 ? t("room.roll.totalFail", { count: -total }) : t("room.roll.total", { count: total }),
    ].join("\n");
}

/** What a single roll against a target came to, for the sheet that rolled it; null for anything else. */
export function versusOutcome(data: ResultData | null | undefined): VersusOutcome | null {
    if (data?.kind !== "versus" || data.repeat || data.rolls.length !== 1) return null;
    const roll = data.rolls[0];
    return {
        roll: roll.roll, target: data.target, success: roll.success, degrees: roll.degrees, crit: !!roll.crit, doubles: !!roll.doubles,
    };
}
