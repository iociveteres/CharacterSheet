// Lists of a name and a description: notes, traits, talents, mutations,
// mental disorders and diseases.
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, type AutocompleteResult } from "../components/context";
import { NumberField, TextArea, TextField, hasText } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/useAutocomplete";
import { nameAndTypeOption } from "./autocompleteOptions";

interface Autocomplete {
    collection: string;
    renderOption: (r: AutocompleteResult) => string;
}

export function NamedDescriptionItem({ itemId, autocomplete }: { itemId: string; autocomplete?: Autocomplete }) {
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(`${path}.description`) });

    return (
        <Scope dataId={itemId} class={collapsed ? "item-with-description collapsed" : "item-with-description"} elRef={elRef}>
            <div class="split-header">
                {autocomplete
                    ? <AutocompleteField field="name" itemPath={path} {...autocomplete} />
                    : <TextField field="name" />}
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

interface ListProps {
    /** The grid's data-id, e.g. "talents.list.items". */
    dataId: string;
    /** DOM id of the grid, also the prefix of new item ids. */
    id: string;
    columns: number;
    autocomplete?: Autocomplete;
}

export function NamedDescriptionList({ dataId, id, columns, autocomplete }: ListProps) {
    return (
        <ItemGrid
            dataId={dataId}
            id={id}
            columns={columns}
            itemClass="item-with-description"
            renderItem={itemId => <NamedDescriptionItem itemId={itemId} autocomplete={autocomplete} />}
        />
    );
}

export const Notes = () => <NamedDescriptionList dataId="notes.list.items" id="notes" columns={1} />;

export const Traits = () => (
    <NamedDescriptionList dataId="traits.list.items" id="traits" columns={3}
        autocomplete={{ collection: "traits", renderOption: nameAndTypeOption }} />
);

export const Talents = () => (
    <NamedDescriptionList dataId="talents.list.items" id="talents" columns={3}
        autocomplete={{ collection: "talents", renderOption: nameAndTypeOption }} />
);

export const Mutations = () => <NamedDescriptionList dataId="mutations.list.items" id="mutations" columns={1} />;

export const Diseases = () => <NamedDescriptionList dataId="diseases.list.items" id="diseases" columns={1} />;

export function MentalDisorders() {
    return (
        <>
            <Scope dataId="mentalDisorders" class="layout-column centered-bar item-like-height">
                <div class="layout-row">
                    <label>
                        Insanity:
                        <NumberField field="insanityPoints" class="short" />
                    </label>
                </div>
            </Scope>
            <NamedDescriptionList dataId="mentalDisorders.list.items" id="mental-disorders" columns={1} />
        </>
    );
}
