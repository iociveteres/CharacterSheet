import { useRef } from "preact/hooks";
import { useDropdown } from "../components/Dropdown";
import { CalculatedCharacteristics, PermanentCharacteristics, usePermanentFocus } from "../characteristics/Characteristics";
import { Conditions } from "./Conditions";

/**
 * The computed and permanent characteristics with Conditions behind a button
 * of the sheet's controls, on whatever tab is open. Rendered only while
 * open: it doubles the fields of the Player Sheet tab, which stay mounted.
 */
export function ConditionsControl() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const { edit, permRef } = usePermanentFocus(dropdown.show);

    return (
        <div class="conditions-control" ref={ref}>
            <button
                class={dropdown.open ? "conditions-toggle active" : "conditions-toggle"}
                type="button"
                title="Characteristics and conditions"
                onClick={dropdown.toggle}
            >
                {dropdown.open ? "Close Stats" : "Open Stats"}
            </button>
            {dropdown.open && (
                <div class="controls-dropdown conditions-dropdown layout-column">
                    <h4>Total</h4>
                    <CalculatedCharacteristics onEdit={edit} />
                    <PermanentCharacteristics permRef={permRef} />
                    <Conditions />
                </div>
            )}
        </div>
    );
}
