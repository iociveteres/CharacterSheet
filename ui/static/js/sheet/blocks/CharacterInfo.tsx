// Character information, with the portrait left of the first column. The
// room learns the character name from the state (characterName.ts), not from this block.
import { TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { useSheet } from "../components/context";
import { Portrait, showsPortrait } from "./Portrait";

const COLUMNS: readonly (readonly [string, string][])[] = [
    [
        ["characterName", "Character Name"],
        ["archetype", "Archetype"],
        ["race", "Race"],
        ["warbandName", "Warband Name"],
        ["age", "Age"],
    ],
    [
        ["homeworld", "Homeworld"],
        ["origin", "Origin"],
        ["pride", "Pride"],
        ["disgrace", "Disgrace"],
        ["motivation", "Motivation"],
    ],
];

export function CharacterInfo() {
    const { portrait, canEdit } = useSheet();
    const withPortrait = showsPortrait(portrait.value, canEdit);
    return (
        <Scope dataId="characterInfo" id="character_info" class={withPortrait ? "character-info with-portrait" : "character-info"}>
            {withPortrait && <Portrait />}
            {COLUMNS.map((fields, i) => (
                <div key={i}>
                    {fields.map(([field, label]) => (
                        <div key={field} class="layout-row">
                            <label>{label}:</label>
                            <TextField field={field} />
                        </div>
                    ))}
                </div>
            ))}
        </Scope>
    );
}
