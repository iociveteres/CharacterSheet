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

/** The cards that skip their rendering off screen (sheet.css). */
const CARDS = ".item-grid > .layout-column > .item-with-description";

/** How many screens beyond the viewport the cards are drawn ahead of Chrome's own margin. */
const AHEAD = 2;

/**
 * Marks the cards of `panel` within AHEAD screens of the viewport as near, which sheet.css draws
 * whatever Chrome thinks. Chrome draws the cards of content-visibility: auto only some way beyond
 * the viewport and only in the frame after they come that close, while the compositor scrolls on
 * its own: a fast wheel at CPU 4x scrolled 1500 px between two frames of Stress XL, past what was
 * drawn. The marks are set in the scroll event, before the frame of that scroll is drawn.
 */
function useDrawAhead(panelRef: { current: HTMLElement | null }, active: boolean): void {
    useEffect(() => {
        const panel = panelRef.current;
        if (!active || !panel) return;
        // The box that scrolls the sheet is the room's, outside the shadow root: the scroll events
        // of the document are caught on their way down, and so no style is read to find it.
        const root = panel.getRootNode();
        const host = root instanceof ShadowRoot ? root.host : panel;
        let box: Element | null = null;
        let idle = 0;
        /** Marks the cards within `screens` of the viewport and unmarks the others. */
        const mark = (screens: number) => {
            const view = box ? box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
            const margin = (view.bottom - view.top) * screens;
            const cards = Array.from(panel.querySelectorAll<HTMLElement>(CARDS));
            // All the reads before any write: a mark changes the style, and a read after it would lay out.
            const near = cards.map(card => {
                const r = card.getBoundingClientRect();
                return r.bottom > view.top - margin && r.top < view.bottom + margin;
            });
            cards.forEach((card, i) => {
                if (near[i] !== card.hasAttribute("data-near")) card.toggleAttribute("data-near", near[i]);
            });
        };
        // At rest only the cards on screen keep the mark, or every edit would draw the cards ahead
        // too; a card on screen that lost it would be skipped for a frame.
        // A tab's radio comes two elements before its panel.
        const radio = panel.previousElementSibling?.previousElementSibling as HTMLInputElement | null;
        const scrolled = (e: Event) => {
            // Opening another tab scrolls the box too, before this panel's effect is gone: reading the
            // cards of a closed panel would lay out the sheet in the middle of the switch.
            if (radio && !radio.checked) return;
            const target = e.target;
            if (target instanceof Element) {
                if (!target.contains(host)) return;
                box = target;
            } else {
                box = null;
            }
            mark(AHEAD);
            clearTimeout(idle);
            idle = window.setTimeout(() => mark(0.5), 300);
        };
        document.addEventListener("scroll", scrolled, { capture: true, passive: true });
        return () => {
            document.removeEventListener("scroll", scrolled, { capture: true });
            clearTimeout(idle);
            for (const card of panel.querySelectorAll<HTMLElement>("[data-near]")) card.removeAttribute("data-near");
        };
    }, [active]);
}

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
    useDrawAhead(panelRef, open && drawn);
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
