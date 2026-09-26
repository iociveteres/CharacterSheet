// Character information. The room learns the character name from the state
// (characterName.ts), not from this block.
import { TextField } from "../components/fields";
import { Scope } from "../components/Scope";

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
    return (
        <Scope dataId="characterInfo" id="character_info" class="character-info">
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
