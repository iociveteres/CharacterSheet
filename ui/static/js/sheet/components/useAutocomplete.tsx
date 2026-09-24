import { useLayoutEffect, useRef } from "preact/hooks";
import { useSheet, type AutocompleteResult } from "./context";

/**
 * Autocomplete on an item's name field, a wrapper over the sheet's
 * Autocomplete instance. Pass `inputRef` to the field and render
 * <AutocompleteAnchor anchorRef={anchorRef} /> next to it: the dropdown goes
 * into that element, which Preact renders nothing into.
 *
 * Picking a result sends autocompleteApply for the item. The state and the
 * field change when autocompleteApplied comes back, for this player too.
 */
export function useAutocomplete(itemPath: string, collection: string, renderOption: (r: AutocompleteResult) => string) {
    const { autocomplete, actions } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const anchorRef = useRef<HTMLSpanElement>(null);
    const render = useRef(renderOption);
    render.current = renderOption;

    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!autocomplete || !input) return;
        autocomplete.register(input, {
            buildQuery: query => ({ type: "autocomplete", collection, query }),
            onSelect: result => actions.autocompleteApply(itemPath, collection, result.name),
            renderOption: result => render.current(result),
        }, { anchor: anchorRef.current });
        return () => autocomplete.unregister(input);
    }, [autocomplete, actions, itemPath, collection]);

    return { inputRef, anchorRef };
}

export function AutocompleteAnchor({ anchorRef }: { anchorRef: ReturnType<typeof useAutocomplete>["anchorRef"] }) {
    return <span class="autocomplete-anchor" ref={anchorRef} />;
}
