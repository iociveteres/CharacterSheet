// The range of a ranged attack with its modifiers (weapons/rangeRules.ts), as
// ModdedField shows a damage: the row shows the total; a click on it or the
// gear next to it opens the dropdown with the weapon's own range and the
// modifiers, which add or multiply.
import { useEffect, useRef } from "preact/hooks";
import { t } from "../../i18n";
import { useComputed } from "@preact/signals";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, ReadonlyField, TextField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { THROWN_RANGE, rangeAt, rangeMod, type RangeMod } from "./rangeRules";
import { textAt, valueAt } from "../core/sync";

const EXPR_TITLE = t("sheet.weapons.range.exprTitle");

const modText = (mod: RangeMod) => ("factor" in mod ? `×${mod.factor}${mod.roundUp ? "▲" : ""}` : mod.add < 0 ? String(mod.add) : `+${mod.add}`);

function RangeModRow({ itemId }: { itemId: string }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const expr = textAt(state, `${path}.expr`);
    const mod = useComputed(() => rangeMod(state, textAt(state, `${path}.expr`))).value;
    const enabled = !!valueAt(state, `${path}.enabled`);
    const invalid = expr.trim() !== "" && mod === null;
    return (
        <Scope dataId={itemId} class={enabled ? "weapon-mod" : "weapon-mod disabled"}>
            <Checkbox field="enabled" class="custom" title={t("sheet.weapons.range.modCounts")} />
            <TextField field="expr" class={invalid ? "mod-expr invalid" : "mod-expr"} placeholder="×2, +5, S.b"
                title={invalid ? `${t("sheet.weapons.range.invalid")}\n\n${EXPR_TITLE}` : EXPR_TITLE} />
            <span class="mod-added" data-id="added">{mod ? modText(mod) : "—"}</span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** The range of the ranged attack at the enclosing path. */
export function RangeField() {
    const { state } = useSheet();
    const path = usePath();
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const range = useComputed(() => rangeAt(state, path));
    const text = useComputed(() => range.value.text);
    const hasMods = useItemIds(`${path}.rangeMods.items`).ids.length > 0;
    const { base, byRule, baseValue, mods } = range.value;
    const title = baseValue === null ? "" : [`${byRule ? t("sheet.weapons.range.thrownByRule") : t("sheet.termsArms.gearType.weapon")} ${base} = ${baseValue}`, ...mods.map(m => `${m.expr} ${modText(m)}`)].join("\n");

    // A click on the total opens the dropdown at the weapon's own range.
    const focusBase = useRef(false);
    useEffect(() => {
        if (!dropdown.open) return;
        if (focusBase.current) baseRef.current?.focus();
        focusBase.current = false;
    }, [dropdown.open]);
    const editBase = () => {
        focusBase.current = true;
        if (dropdown.open) baseRef.current?.focus();
        else dropdown.show();
    };

    return (
        <div class="mod-field dropdown-parent" ref={ref}>
            <ReadonlyField field="rangeTotal" value={text} class="mod-total" onClick={editBase} title={title} />
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={t("sheet.weapons.range.toggle")}
                onClick={dropdown.toggle}>⚙</button>
            {/* Rendered only while open, as ModdedField's. */}
            {dropdown.open && (
                <div class="roll-dropdown mod-dropdown visible">
                    <label class="mod-base" title={t("sheet.weapons.range.own")}>
                        <span class="column-label">{t("sheet.termsArms.gearType.weapon")}</span>
                        <TextField field="range" inputRef={baseRef} placeholder={byRule ? THROWN_RANGE : "50м, S.b×10м"} />
                    </label>
                    {byRule && <p class="mod-note-quiet" data-id="rule">{t("sheet.weapons.range.thrownRule", { range: THROWN_RANGE })}</p>}
                    <div class="mods-header">
                        <span class="column-label">{t("sheet.weapons.modifiers")}</span>
                    </div>
                    {!hasMods && <p class="mod-hint">{t("sheet.weapons.range.hint")}</p>}
                    <ItemGrid dataId="rangeMods.items" class="weapon-mods" itemClass="weapon-mod" idPrefix="range-mod"
                        renderItem={id => <RangeModRow itemId={id} />} />
                    {hasMods && base && baseValue === null && (
                        <p class="mod-note">{t("sheet.weapons.range.noExpression")}</p>
                    )}
                    <div class="mod-result">
                        <span class="column-label">{t("common.total")}</span>
                        <span class="mod-result-value" data-id="result">{text}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
