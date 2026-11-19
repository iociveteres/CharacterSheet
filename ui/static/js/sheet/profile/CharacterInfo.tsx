// Character information, with the portrait left of the first column. The
// room learns the character name from the state (characterName.ts), not from this block.
import { TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { useSheet } from "../components/context";
import { Portrait, showsPortrait } from "./Portrait";
import { t } from "../../i18n";

const COLUMNS: readonly (readonly [string, string][])[] = [
    [
        ["characterName", t("sheet.profile.info.characterName")],
        ["archetype", t("sheet.terms.profile.archetype")],
        ["race", t("sheet.terms.profile.race")],
        ["warbandName", t("sheet.profile.info.warbandName")],
        ["age", t("sheet.profile.info.age")],
    ],
    [
        ["homeworld", t("sheet.profile.info.homeworld")],
        ["origin", t("sheet.profile.info.origin")],
        ["pride", t("sheet.terms.profile.pride")],
        ["disgrace", t("sheet.terms.profile.disgrace")],
        ["motivation", t("sheet.terms.profile.motivation")],
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
