// The navigation tabs of the sheet and the tabs the kinds share; each kind
// lays out its sheet from them (kinds/<kind>.tsx).
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { Armour } from "../blocks/Armour";
import { MeleeAttacks, RangedAttacks } from "../blocks/Attacks";
import { BlockHeading } from "../blocks/BlockSettings";
import { CharacterInfo } from "../blocks/CharacterInfo";
import { Characteristics } from "../blocks/Characteristics";
import { Fatigue, Infamy, InitiativeAndSize, Movement } from "../blocks/Combat";
import { CustomSkills } from "../blocks/CustomSkills";
import { Experience } from "../blocks/Experience";
import { CarryWeight, Cybernetics, Gear } from "../blocks/Gear";
import { Diseases, MentalDisorders, Mutations, Notes, Talents, Traits } from "../blocks/NamedDescriptions";
import { PowerShields } from "../blocks/PowerShields";
import { ResourceTrackers } from "../blocks/ResourceTrackers";
import { Skills } from "../blocks/Skills";
import { useSheet } from "../components/context";

interface NavTabProps {
    /** The id of the radio button. */
    id: string;
    label: string;
    /** The id and classes of the panel. */
    panelId: string;
    panelClass: string;
    first?: boolean;
    children: ComponentChildren;
}

// Not a state path: the navigation is layout, not sheet content.
const NAVIGATION = "navigation-tabs";

/** The navigation of the sheet, around its NavTabs. */
export function Navigation({ children }: { children: ComponentChildren }) {
    return <div class="tabs" id={NAVIGATION}>{children}</div>;
}

/**
 * A tab of the sheet's navigation. The closed panels are hidden by CSS
 * (.radiotab:checked + .tablabel + .panel), and Toggle Descs works on the
 * open one. The open tab is UI state, so the sheet read again keeps it, and
 * renders only it until another one opens.
 */
export function NavTab({ id, label, panelId, panelClass, first = false, children }: NavTabProps) {
    const selected = useSheet().ui.selectedTabSignal(NAVIGATION);
    const open = selected.value === null ? first : selected.value === id;
    // A panel renders when first opened and then stays: the closed ones are half
    // of a big sheet, and the CSS skips only their layout.
    const opened = useRef(false);
    if (open) opened.current = true;
    return (
        <>
            <input class="radiotab" type="radio" id={id} name="toggle"
                checked={open}
                onChange={() => { selected.value = id; }} />
            <label class="tablabel" for={id}>{label}</label>
            <div id={panelId} class={`${panelClass} panel`}>{opened.current && children}</div>
        </>
    );
}

export function PlayerSheetTab() {
    return (
        <NavTab id="show-player-sheet" label="Player Sheet" panelId="player-sheet" panelClass="character-sheet" first>
            <h2 class="align-self-center">Character Information</h2>
            <div class="character-sheet-grid">
                <CharacterInfo />

                <div class="layout-row items-start">
                    <div class="layout-column" id="character-sheet-left-col">
                        <Characteristics />

                        <div id="skills" class="skills-block">
                            <div>
                                <h3>Skills</h3>
                                <div class="skill-list">
                                    <Skills />
                                </div>
                            </div>

                            <div class="custom-skills">
                                <h3>Custom skills</h3>
                                <CustomSkills />
                            </div>
                        </div>
                    </div>

                    <div class="layout-column" id="character-sheet-right-col">
                        <h3>Notes</h3>
                        <Notes />
                    </div>
                </div>
            </div>
        </NavTab>
    );
}

/** `points` names the points of the Infamy block: Infamy Points, or Fame Points in Pathfinder Crusade. */
export function CombatTab({ points }: { points: string }) {
    return (
        <NavTab id="show-combat" label="Combat" panelId="combat" panelClass="combat">
            <h2 class="align-self-center">Combat</h2>
            <div class="layout-row gap-5">
                <div class="statblock layout-column">
                    <div class="layout-column">
                        <div class="layout-row content-around">
                            <div class="layout-column infamy-block">
                                <h3>{points}</h3>
                                <Infamy />
                            </div>
                            <div class="layout-column fatigue-block">
                                <h3>Fatigue</h3>
                                <Fatigue />
                            </div>
                        </div>
                        <div class="layout-row">
                            <ResourceTrackers />
                        </div>
                        <div class="layout-row content-around">
                            <InitiativeAndSize />
                        </div>
                    </div>

                    <div>
                        <h3>Movement</h3>
                        <Movement />
                    </div>

                    <div id="armour" class="armour">
                        <h3>Armour & Defence</h3>
                        <Armour />
                    </div>

                    <div id="power-shields">
                        <h3>Power Shields</h3>
                        <PowerShields />
                    </div>
                </div>
                <div class="layout-column full-width">
                    <BlockHeading level="h3" heading="Ranged Attacks" block="rangedAttacks" rolls="Attacks" title="Test options of the ranged attacks" />
                    <RangedAttacks />

                    <BlockHeading level="h3" heading="Melee Attacks" block="meleeAttacks" rolls="Attacks" title="Test options of the melee attacks" />
                    <MeleeAttacks />
                </div>
            </div>
        </NavTab>
    );
}

export function TalentsTab() {
    return (
        <NavTab id="show-talents" label="Talents" panelId="traits-and-talents" panelClass="talents">
            <h2 class="align-self-center">Traits and Talents</h2>
            <h3>Traits</h3>
            <Traits />

            <h3>Talents</h3>
            <Talents />
        </NavTab>
    );
}

export function GearTab() {
    return (
        <NavTab id="show-gear" label="Gear" panelId="inventory" panelClass="gear">
            <div class="layout-column">
                <h2 class="align-self-center">Weight</h2>
                <CarryWeight />

                <h2 class="align-self-center">Gear</h2>
                <Gear />

                <h2 class="align-self-center">Cybernetics</h2>
                <Cybernetics />
            </div>
        </NavTab>
    );
}

export function AdvancementsTab() {
    return (
        <NavTab id="show-advancements" label="Advancements" panelId="advancements" panelClass="advancements">
            <div id="advancements-grid">
                <Experience />

                <div>
                    <h2 class="align-self-center">Mutations</h2>
                    <Mutations />
                </div>
                <div>
                    <h2 class="align-self-center">Mental Disorders</h2>
                    <MentalDisorders />
                </div>
                <div>
                    <h2 class="align-self-center">Diseases</h2>
                    <Diseases />
                </div>
            </div>
        </NavTab>
    );
}
