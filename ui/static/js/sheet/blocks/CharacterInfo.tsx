// Character information. An edit of the character name also goes to the room
// list of sheets (room/network.js), which shows the name.
import { useSheet } from "../components/context";
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
    const { sheetId } = useSheet();
    const announceName = (name: string) => document.dispatchEvent(new CustomEvent("sheet:nameChanged", {
        detail: { sheetID: sheetId, change: name },
    }));
    return (
        <Scope dataId="characterInfo" id="character_info" class="character-info">
            {COLUMNS.map((fields, i) => (
                <div key={i}>
                    {fields.map(([field, label]) => (
                        <div key={field} class="layout-row">
                            <label>{label}:</label>
                            <TextField
                                field={field}
                                onInput={field === "characterName" ? e => announceName(e.currentTarget.value) : undefined}
                            />
                        </div>
                    ))}
                </div>
            ))}
        </Scope>
    );
}
