import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import type { Autocomplete } from "../autocomplete";
import { useSheet, type AutocompleteResult } from "./context";
import { nameAndTypeOption } from "./autocompleteOptions";
import { TextField, type FieldProps } from "./fields";
import { DropdownOption, InputDropdown } from "./InputDropdown";

export interface AutocompleteFieldProps extends Omit<FieldProps<string>, "inputRef"> {
    itemPath: string;
    collection: string;
    /** One option of the dropdown; the name and the entry type by default. */
    renderOption?: (r: AutocompleteResult) => ComponentChildren;
    /** The new item the picked entry is laid over; a new item of the schema by default. */
    base?: () => object;
}

/**
 * A text field of the item at `itemPath` with the collection's autocomplete.
 * Picking a result sends autocompleteApply for the item. The state and the
 * field change when autocompleteApplied comes back, for this player too.
 */
export function AutocompleteField({ itemPath, collection, renderOption = nameAndTypeOption, base, ...field }: AutocompleteFieldProps) {
    const { autocomplete, actions } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);

    const pick = (result: AutocompleteResult) => {
        autocomplete?.close();
        actions.autocompleteApply(itemPath, collection, result.name, base?.());
    };
    const pickRef = useRef(pick);
    pickRef.current = pick;

    // TextField sends the edit from its own onInput, so the query listens beside it.
    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!autocomplete || !input) return;
        const onInput = () => autocomplete.type(input, query => ({ type: "autocomplete", collection, query }));
        const onKeyDown = (e: KeyboardEvent) => {
            const s = autocomplete.suggestions.peek();
            if (s?.input !== input) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                autocomplete.move(e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "Enter" && s.active >= 0) {
                e.preventDefault();
                pickRef.current(s.results[s.active]);
            } else if (e.key === "Escape") {
                autocomplete.close(input);
            }
        };
        input.addEventListener("input", onInput);
        input.addEventListener("keydown", onKeyDown);
        return () => {
            input.removeEventListener("input", onInput);
            input.removeEventListener("keydown", onKeyDown);
            autocomplete.close(input);
        };
    }, [autocomplete, collection]);

    return (
        <>
            <TextField {...field} inputRef={inputRef} />
            {autocomplete && <Dropdown autocomplete={autocomplete} inputRef={inputRef} renderOption={renderOption} onPick={pick} />}
        </>
    );
}

interface DropdownProps {
    autocomplete: Autocomplete;
    inputRef: RefObject<HTMLInputElement>;
    renderOption: (r: AutocompleteResult) => ComponentChildren;
    onPick: (r: AutocompleteResult) => void;
}

/**
 * The results under the field. Only this component follows the suggestions, so
 * the item does not re-render when another field's results come.
 */
function Dropdown({ autocomplete, inputRef, renderOption, onPick }: DropdownProps) {
    const mine = useComputed(() => {
        const s = autocomplete.suggestions.value;
        return s && s.input === inputRef.current ? s : null;
    });
    const s = mine.value;
    return (
        <span class="autocomplete-anchor">
            {s && (
                <InputDropdown inputRef={inputRef} active={s.active} onClose={() => autocomplete.close(inputRef.current ?? undefined)}>
                    {s.results.map((r, i) => (
                        <DropdownOption key={i} active={i === s.active} onPick={() => onPick(r)}>{renderOption(r)}</DropdownOption>
                    ))}
                </InputDropdown>
            )}
        </span>
    );
}
