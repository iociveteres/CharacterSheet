import { Fragment, type ComponentChildren, type RefObject } from "preact";
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
    /** Results of the sheet itself, shown above the collection's. */
    local?: LocalResults;
}

/** What a field offers of the sheet itself before the collection's results, as the gear weapons for an attack's name. */
export interface LocalResults {
    /** Their heading; the collection's go under "Rulebook". */
    group: string;
    results: (query: string) => AutocompleteResult[];
    pick: (result: AutocompleteResult) => void;
}

/** The key that marks a result of the sheet, with its group as the value; the server's results have no such key. */
const LOCAL = "localGroup";

const markedAs = (group: string, results: (query: string) => AutocompleteResult[]) =>
    (query: string) => results(query).map(r => ({ ...r, [LOCAL]: group }));

/**
 * A text field of the item at `itemPath` with the collection's autocomplete.
 * Picking a result sends autocompleteApply for the item. The state and the
 * field change when autocompleteApplied comes back, for this player too.
 */
export function AutocompleteField({ itemPath, collection, renderOption = nameAndTypeOption, base, local, ...field }: AutocompleteFieldProps) {
    const { autocomplete, actions } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);

    const pick = (result: AutocompleteResult) => {
        autocomplete?.close();
        if (local && result[LOCAL]) local.pick(result);
        else actions.autocompleteApply(itemPath, collection, result.name, base?.());
    };
    useAutocompleteInput(inputRef, collection, pick, local && markedAs(local.group, local.results));

    return (
        <>
            <TextField {...field} inputRef={inputRef} />
            {autocomplete && <AutocompleteDropdown autocomplete={autocomplete} inputRef={inputRef} renderOption={renderOption} onPick={pick} />}
        </>
    );
}

/**
 * Queries `collection` for the text typed in the input at `inputRef` and
 * moves through the results with the arrows; Enter on an active option picks
 * it. Listens beside the input's own handlers, so a field sends its edit as
 * usual. `local` gives the results of the sheet that go first. Does nothing
 * without the sheet's autocomplete.
 */
export function useAutocompleteInput(
    inputRef: RefObject<HTMLInputElement>, collection: string, onPick: (r: AutocompleteResult) => void,
    local?: (query: string) => AutocompleteResult[],
): void {
    const { autocomplete, kindName } = useSheet();
    const pickRef = useRef(onPick);
    pickRef.current = onPick;
    const localRef = useRef(local);
    localRef.current = local;

    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!autocomplete || !input) return;
        const onInput = () => autocomplete.type(input, query => ({ type: "autocomplete", kind: kindName, collection, query }),
            localRef.current && (query => localRef.current?.(query) ?? []));
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
    }, [autocomplete, kindName, collection]);
}

interface DropdownProps {
    autocomplete: Autocomplete;
    inputRef: RefObject<HTMLInputElement>;
    renderOption: (r: AutocompleteResult) => ComponentChildren;
    onPick: (r: AutocompleteResult) => void;
}

/**
 * The results under the field. Only this component follows the suggestions, so
 * the item does not re-render when another field's results come. Results of
 * the sheet come first under their heading, the collection's under Rulebook.
 */
export function AutocompleteDropdown({ autocomplete, inputRef, renderOption, onPick }: DropdownProps) {
    const mine = useComputed(() => {
        const s = autocomplete.suggestions.value;
        return s && s.input === inputRef.current ? s : null;
    });
    const s = mine.value;
    return (
        <span class="autocomplete-anchor">
            {s && (
                <InputDropdown inputRef={inputRef} active={s.active} onClose={() => autocomplete.close(inputRef.current ?? undefined)}>
                    {s.results.map((r, i) => {
                        const group = s.results.some(o => o[LOCAL]) ? String(r[LOCAL] ?? "Rulebook") : "";
                        const heading = group && (i === 0 || group !== String(s.results[i - 1][LOCAL] ?? "Rulebook"));
                        return (
                            <Fragment key={i}>
                                {heading && <div class="autocomplete-group">{group}</div>}
                                <DropdownOption active={i === s.active} onPick={() => onPick(r)}>{renderOption(r)}</DropdownOption>
                            </Fragment>
                        );
                    })}
                </InputDropdown>
            )}
        </span>
    );
}
