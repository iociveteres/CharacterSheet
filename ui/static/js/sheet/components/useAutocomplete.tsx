import { useLayoutEffect, useRef } from "preact/hooks";
import { useSheet, type AutocompleteResult } from "./context";
import { TextField, type FieldProps } from "./fields";

export interface AutocompleteOptions {
    /** The new item the picked entry is laid over; a new item of the schema by default. */
    base?: () => object;
}

/**
 * Autocomplete on an item's name field, a wrapper over the sheet's
 * Autocomplete instance. Pass `inputRef` to the field and render
 * <AutocompleteAnchor anchorRef={anchorRef} /> next to it: the dropdown goes
 * into that element, which Preact renders nothing into.
 *
 * Picking a result sends autocompleteApply for the item. The state and the
 * field change when autocompleteApplied comes back, for this player too.
 */
export function useAutocomplete(
    itemPath: string,
    collection: string,
    renderOption: (r: AutocompleteResult) => string,
    { base }: AutocompleteOptions = {},
) {
    const { autocomplete, actions } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const anchorRef = useRef<HTMLSpanElement>(null);
    const latest = useRef({ renderOption, base });
    latest.current = { renderOption, base };

    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!autocomplete || !input) return;
        autocomplete.register(input, {
            buildQuery: query => ({ type: "autocomplete", collection, query }),
            onSelect: result => actions.autocompleteApply(itemPath, collection, result.name, latest.current.base?.()),
            renderOption: result => latest.current.renderOption(result),
        }, { anchor: anchorRef.current });
        return () => autocomplete.unregister(input);
    }, [autocomplete, actions, itemPath, collection]);

    return { inputRef, anchorRef };
}

export function AutocompleteAnchor({ anchorRef }: { anchorRef: ReturnType<typeof useAutocomplete>["anchorRef"] }) {
    return <span class="autocomplete-anchor" ref={anchorRef} />;
}

export interface AutocompleteFieldProps extends Omit<FieldProps, "inputRef">, AutocompleteOptions {
    itemPath: string;
    collection: string;
    renderOption: (r: AutocompleteResult) => string;
}

/** A text field of the item at `itemPath` with the collection's autocomplete. */
export function AutocompleteField({ itemPath, collection, renderOption, base, ...field }: AutocompleteFieldProps) {
    const { inputRef, anchorRef } = useAutocomplete(itemPath, collection, renderOption, { base });
    return (
        <>
            <TextField {...field} inputRef={inputRef} />
            <AutocompleteAnchor anchorRef={anchorRef} />
        </>
    );
}
