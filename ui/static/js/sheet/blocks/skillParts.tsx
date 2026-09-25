// Parts that skill rows and custom skills share: the advance checkboxes and
// the difficulty that rolls a test.
import type { JSX } from "preact";
import { Checkbox, ReadonlyField, peekAt } from "../components/fields";
import { bonusSuccessesOf, rollVersus } from "../rollEvents";

export const ADVANCES = ["plus0", "plus10", "plus20", "plus30"] as const;

type Advances = { [K in (typeof ADVANCES)[number]]: boolean };

/**
 * The advances after a click on one of them: checking a box checks every box
 * before it, unchecking clears every box after it.
 */
export function advancesAfterClick(current: Advances, clicked: string, checked: boolean): Advances {
    const index = ADVANCES.indexOf(clicked as keyof Advances);
    const out = { ...current };
    ADVANCES.forEach((key, i) => {
        if (checked && i <= index) out[key] = true;
        if (!checked && i >= index) out[key] = false;
    });
    return out;
}

/**
 * onChange of a skill row. A click on an advance sends all four of them as
 * one batch of the row: the fieldsUpdated event goes to network.js, which
 * writes the signals and sends the batch. normalizeChange sends nothing for
 * the checkboxes themselves.
 */
export function onAdvanceChange(rowPath: string) {
    return (e: JSX.TargetedEvent<HTMLElement, Event>) => {
        const box = e.target as HTMLInputElement;
        if (box.type !== "checkbox" || !ADVANCES.includes(box.dataset.id as keyof Advances)) return;
        const current = Object.fromEntries(ADVANCES.map(key => [key, !!peekAt(`${rowPath}.${key}`)])) as Advances;
        const changes = advancesAfterClick(current, box.dataset.id!, box.checked);
        e.currentTarget.dispatchEvent(new CustomEvent("fieldsUpdated", { bubbles: true, detail: { changes } }));
    };
}

/** The four advance checkboxes, each in a label, in table cells for skill rows. */
export function AdvanceCheckboxes({ cells = false }: { cells?: boolean }) {
    return (
        <>
            {ADVANCES.map(key => {
                const box = <label key={key} class="chk-label"><Checkbox field={key} class="custom" /></label>;
                return cells ? <td key={key}>{box}</td> : box;
            })}
        </>
    );
}

/** The test difficulty; a click rolls the test on the row's characteristic. */
export function Difficulty({ rowPath, label }: { rowPath: string; label: () => string }) {
    const roll = () => {
        const target = Number(peekAt(`${rowPath}.difficulty`));
        if (Number.isNaN(target)) return;
        const characteristic = String(peekAt(`${rowPath}.characteristic`) ?? "");
        rollVersus(target, bonusSuccessesOf(characteristic), label());
    };
    return <ReadonlyField field="difficulty" class="short rollable" onClick={roll} />;
}
