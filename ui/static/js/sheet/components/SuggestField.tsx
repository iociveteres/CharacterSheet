// A text field that lists suggestions under it while it has the focus, like a
// select that also takes any text. Picking one writes its value, in place of
// the whole text or of the part the owner says.
import { Fragment, type RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { optionLabel, optionValue, type Option } from "../schema/constants";
import { joinPath, usePath, useSheet } from "./context";
import { TextField, type FieldProps } from "./fields";
import { DropdownOption, InputDropdown } from "./InputDropdown";

export interface SuggestionGroup {
    readonly label: string;
    readonly options: readonly Option[];
}

/** The options of `groups` whose group, label or value holds `query`; all of them for null. */
export function filterGroups(groups: readonly SuggestionGroup[], query: string | null): SuggestionGroup[] {
    const q = query?.trim().toLowerCase();
    if (!q) return [...groups];
    return groups
        .map(g => ({
            label: g.label,
            options: g.options.filter(o => `${g.label} ${optionLabel(o)} ${optionValue(o)}`.toLowerCase().includes(q)),
        }))
        .filter(g => g.options.length > 0);
}

export interface SuggestFieldProps extends Omit<FieldProps<string>, "inputRef" | "onEdit"> {
    /**
     * The options for `query`, null until the player types after focusing, in
     * `text`. Called only while the list is open, so a closed field follows no
     * signals of it.
     */
    suggest: (query: string | null, text: string) => readonly SuggestionGroup[];
    /** What of `text` the typing at `caret` asks for; all of it by default. */
    queryAt?: (text: string, caret: number) => string;
    /** `text` with a picked `value`, `typed` once the player typed; `value` alone by default. */
    insert?: (text: string, caret: number, value: string, typed: boolean) => string;
    /** The field's ref, for an owner that draws next to it; one of its own by default. */
    inputRef?: RefObject<HTMLInputElement>;
}

export function SuggestField({ suggest, queryAt, insert, inputRef: outerRef, ...field }: SuggestFieldProps) {
    const { canEdit, actions } = useSheet();
    const path = joinPath(usePath(), field.field);
    const ownRef = useRef<HTMLInputElement>(null);
    const inputRef = outerRef ?? ownRef;
    const [open, setOpen] = useState(false);
    // Null until the player types after focusing: the focus lists everything.
    const [query, setQuery] = useState<string | null>(null);
    const [active, setActive] = useState(-1);
    const queryAtRef = useRef(queryAt);
    queryAtRef.current = queryAt;
    const queryRef = useRef(query);
    queryRef.current = query;

    const shown = open ? suggest(query, inputRef.current?.value ?? "") : [];
    const options = shown.flatMap(g => g.options);

    const show = () => {
        setOpen(true);
        setQuery(null);
        setActive(-1);
    };
    const close = () => {
        setOpen(false);
        setActive(-1);
    };
    const pick = (o: Option) => {
        const input = inputRef.current;
        const text = input?.value ?? "";
        const value = optionValue(o);
        actions.change(path, insert ? insert(text, input?.selectionStart ?? text.length, value, query !== null) : value);
        close();
    };

    // TextField sends the edit from its own onInput, so the filter listens beside it.
    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        const read = () => queryAtRef.current
            ? queryAtRef.current(input.value, input.selectionStart ?? input.value.length)
            : input.value;
        const onInput = () => {
            setOpen(true);
            setQuery(read());
            setActive(-1);
        };
        // Once typed, the query follows the caret into another token: a pick replaces the token at the caret.
        const onCaret = () => {
            if (queryRef.current === null) return;
            const q = read();
            if (q === queryRef.current) return;
            setQuery(q);
            setActive(-1);
        };
        input.addEventListener("input", onInput);
        input.addEventListener("keyup", onCaret);
        input.addEventListener("pointerup", onCaret);
        return () => {
            input.removeEventListener("input", onInput);
            input.removeEventListener("keyup", onCaret);
            input.removeEventListener("pointerup", onCaret);
        };
    }, []);

    const onKeyDown = (e: KeyboardEvent) => {
        if (!canEdit) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) show();
            else setActive(Math.max(0, Math.min(active + (e.key === "ArrowDown" ? 1 : -1), options.length - 1)));
        } else if (e.key === "Enter" && open && active >= 0) {
            e.preventDefault();
            pick(options[active]);
        } else if (e.key === "Escape" && open) {
            close();
        }
    };

    let index = -1;
    return (
        <>
            <TextField {...field} inputRef={inputRef} onFocus={() => canEdit && show()} onBlur={close} onKeyDown={onKeyDown} />
            <span class="autocomplete-anchor">
                {options.length > 0 && (
                    <InputDropdown inputRef={inputRef} active={active} onClose={close} class="suggestions" grow>
                        {shown.map(g => (
                            <Fragment key={g.label}>
                                <div class="autocomplete-group">{g.label}</div>
                                {g.options.map(o => {
                                    const i = ++index;
                                    return (
                                        <DropdownOption key={optionValue(o)} active={i === active} onPick={() => pick(o)}>
                                            {optionLabel(o)}
                                        </DropdownOption>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </InputDropdown>
                )}
            </span>
        </>
    );
}
