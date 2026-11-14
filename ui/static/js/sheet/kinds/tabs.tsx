// The navigation tabs of the sheet and the tabs the kinds share; each kind
// lays out its sheet from them (kinds/<kind>.tsx).
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Armour } from "../gear/Armour";
import { MeleeAttacks, RangedAttacks } from "../weapons/Attacks";
import { useLinkedAttacks } from "../weapons/LinkedAttacks";
import { MeleeAttacksHeading } from "../weapons/Stances";
import { BlockHeading } from "../rolls/BlockSettings";
import { CharacterInfo } from "../profile/CharacterInfo";
import { Characteristics } from "../characteristics/Characteristics";
import { Conditions } from "../conditions/Conditions";
import { Fatigue, Infamy, InitiativeAndSize, Movement, MovementHeading } from "../combat/Combat";
import { CustomSkills } from "../characteristics/CustomSkills";
import { Experience } from "../profile/Experience";
import { CarryWeight, Cybernetics, Gear } from "../gear/Gear";
import { Diseases, MentalDisorders, Mutations, Notes, Talents, Traits } from "../profile/NamedDescriptions";
import { PowerShields } from "../gear/PowerShields";
import { ResourceTrackers } from "../combat/ResourceTrackers";
import { Skills } from "../characteristics/Skills";
import { useSheet } from "../components/context";
import { COMBAT_TAB, NAVIGATION_TABS } from "../core/ui";

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
const NAVIGATION = NAVIGATION_TABS;

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
    // Its cards skip their rendering off screen (sheet.css .panel.drawn) only once the panel has
    // been drawn at its width: by then each card has remembered its size, so skipping it moves
    // nothing. A skipped card keeps that size, so a new width draws them all again.
    const panelRef = useRef<HTMLDivElement>(null);
    const [drawn, setDrawn] = useState(false);
    useEffect(() => {
        if (!open || drawn) return;
        let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setDrawn(true)); });
        return () => cancelAnimationFrame(frame);
    }, [open, drawn]);
    useEffect(() => {
        const panel = panelRef.current;
        if (!panel || typeof ResizeObserver === "undefined") return;
        let width = panel.clientWidth;
        let timer = 0;
        // While the width changes the cards off screen stay skipped at the sizes they had, and scroll
        // anchoring keeps the cards on screen in place; drawing them all at every step of a window
        // drag took 400 ms a step on Stress XL at CPU 4x. Once the width has been still, the panel is
        // drawn again, so that every card remembers its size at the new width.
        const observer = new ResizeObserver(() => {
            if (panel.clientWidth === width) return;
            width = panel.clientWidth;
            clearTimeout(timer);
            timer = window.setTimeout(() => setDrawn(false), 150);
        });
        observer.observe(panel);
        return () => {
            observer.disconnect();
            clearTimeout(timer);
        };
    }, []);
    return (
        <>
            <input class="radiotab" type="radio" id={id} name="toggle"
                checked={open}
                onChange={() => { selected.value = id; }} />
            <label class="tablabel" for={id}>{label}</label>
            <div id={panelId} ref={panelRef} class={drawn ? `${panelClass} panel drawn` : `${panelClass} panel`}>{opened.current && children}</div>
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
                        <Characteristics>
                            <Conditions />
                        </Characteristics>

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

/** `points` names the points of the Infamy block: Infamy Points, or Fate Points in Pathfinder Crusade. */
export function CombatTab({ points }: { points: string }) {
    return (
        <NavTab id={COMBAT_TAB} label="Combat" panelId="combat" panelClass="combat">
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
                        <MovementHeading />
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

                    <MeleeAttacksHeading />
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

/** `money` is the kind's, as the coins of Pathfinder Crusade. */
export function GearTab({ money }: { money?: ComponentChildren }) {
    const { sheetId } = useSheet();
    return (
        <NavTab id="show-gear" label="Gear" panelId="inventory" panelClass="gear">
            <div class="layout-column">
                <h2 class="align-self-center">Weight</h2>
                <CarryWeight />

                {money && (
                    <>
                        {/* A joke for one player's character on production. */}
                        <h2 class="align-self-center">{sheetId === "652" ? "d4n` pryxozh4n ₮" : "Money"}</h2>
                        {money}
                    </>
                )}

                <h2 class="align-self-center">Gear</h2>
                <Gear useAttacks={useLinkedAttacks} />

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
