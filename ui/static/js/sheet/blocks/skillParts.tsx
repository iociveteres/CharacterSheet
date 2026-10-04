// Parts that skill rows and custom skills share: the advance checkboxes and
// the difficulty that rolls a test.
import { Checkbox, ReadonlyField } from "../components/fields";
import { hoverTitle } from "../components/hoverTitle";
import { skillSummary } from "../state/characteristicSummary";
import { peekAt } from "../state/sync";
import { bonusSuccessesOf } from "../rollEvents";
import { useSheet } from "../components/context";

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
 * The four advance checkboxes of the row at `rowPath`, each in a label, in
 * table cells for skill rows. A click sends all four as one batch of the row,
 * not the clicked checkbox alone.
 */
export function AdvanceCheckboxes({ rowPath, cells = false }: { rowPath: string; cells?: boolean }) {
    const { state, actions } = useSheet();
    const onEdit = (key: string, checked: boolean) => {
        const current = Object.fromEntries(ADVANCES.map(k => [k, !!peekAt(state, `${rowPath}.${k}`)])) as Advances;
        actions.batch(rowPath, advancesAfterClick(current, key, checked));
    };
    return (
        <>
            {ADVANCES.map(key => {
                const box = (
                    <label key={key} class="chk-label">
                        <Checkbox field={key} class="custom" onEdit={checked => onEdit(key, checked)} />
                    </label>
                );
                return cells ? <td key={key}>{box}</td> : box;
            })}
        </>
    );
}

/** The test difficulty; a click rolls the test on the row's characteristic. */
export function Difficulty({ rowPath, label }: { rowPath: string; label: () => string }) {
    const { state, rolls, preview } = useSheet();
    const title = hoverTitle(() => skillSummary(state, rowPath));
    if (preview) return <ReadonlyField field="difficulty" class="short" {...title} />;
    const roll = () => {
        const target = Number(peekAt(state, `${rowPath}.difficulty`));
        if (Number.isNaN(target)) return;
        const characteristic = String(peekAt(state, `${rowPath}.characteristic`) ?? "");
        void rolls.versus(target, bonusSuccessesOf(state, characteristic), label());
    };
    return <ReadonlyField field="difficulty" class="short rollable" onClick={roll} {...title} />;
}
