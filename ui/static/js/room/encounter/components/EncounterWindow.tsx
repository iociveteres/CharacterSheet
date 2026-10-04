// The encounter window of GM mode, in place of the sheet (islands.tsx): the
// turn order, the columns "Party" and "Enemies" and the stat block of the one
// picked; the sheet of a participant opens over it. Only the gamemaster has it.
// "Add monsters" takes the place of the first two columns.
import { encounter, encounterList, encounterTab, popupSheetId, sheetOf } from "../state";
import { closePopup } from "../actions";
import { InitiativeColumn } from "./InitiativeColumn";
import { ParticipantColumn } from "./ParticipantColumn";
import { StatBlockColumn } from "./StatBlockColumn";
import { CollectionsColumn, CreaturesColumn, EncounterTabs } from "./AddMonsters";
import { SheetPopup } from "../../components/SheetPopup";

export function EncounterWindow() {
    if (!encounterList.value) return null;
    const state = encounter.value;
    const monsters = state && encounterTab.value === "monsters";
    return (
        <div class="encounter-window" data-encounter-id={state?.id}>
            <div class="encounter-main">
                {state && <EncounterTabs />}
                <div class="encounter-main-columns">
                    {monsters ? (
                        <>
                            <CollectionsColumn />
                            <CreaturesColumn />
                        </>
                    ) : (
                        <>
                            <InitiativeColumn />
                            {state ? <ParticipantColumn side="party" /> : (
                                <div class="encounter-column encounter-none">
                                    <p class="encounter-muted">No encounter is open. Create one in the menu of the first column.</p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            {state && (
                <>
                    <ParticipantColumn side="enemies" />
                    <StatBlockColumn />
                </>
            )}
            {popupSheetId.value && <SheetPopup sheet={sheetOf(Number(popupSheetId.value))} close={closePopup} />}
        </div>
    );
}
