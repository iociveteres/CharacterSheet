// The stat block of the encounter window and the bestiary (_prd/gm_mode,
// stages 2 and 6): the sheet short, for a fight. It reuses the rolls of the
// blocks, which work on a read-only sheet too, as in the full sheet, and
// edits the fields of a fight in place: ammo, whether a shield is equipped
// and defensive, conditions, trackers, fatigue, cognition and energy; it adds
// conditions too.
// It keeps no UI state of the sheet: collapsing an item here would collapse
// it in the sheet.
import type { RefObject } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { nanoid } from "nanoid";
import { signal } from "@preact/signals";
import { AutocompleteDropdown, useAutocompleteInput } from "../components/AutocompleteField";
import { nameOption } from "../components/autocompleteOptions";
import { columnsFromLayout, createAtEnd } from "../components/columns";
import { useSheet, type AutocompleteResult } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { hoverTitle } from "../components/hoverTitle";
import { Checkbox, NumberField, Select, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { conditionFactory } from "../factories/condition";
import {
    CHARACTERISTICS, MELEE_BASE_SELECTS, MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_BASE_SELECTS, RANGED_ROLL_COLUMNS,
    SHIELD_ARMS, optionLabel, optionValue, type SkillRow,
} from "../schema/constants";
import { armourComputeds, woundsLeft, type ArmourComputeds } from "../state/armour";
import { gridSpecOf } from "../state/fromJson";
import { schemaOf } from "../state/state";
import { powerPR, profileLabel, statAt } from "../state/damage";
import { characteristicSummary, movementSummary, unnaturalSummary } from "../state/characteristicSummary";
import { armourTotalSummary, superArmourSummary, toughnessSummary } from "../state/armourSummary";
import { conditionSummary } from "../state/conditionSummary";
import { idsInOrder } from "../state/gridOrder";
import { psychicPowers } from "../state/psychic";
import { peekAt, numberAt, textAt, valueAt } from "../state/sync";
import {
    costText, processCost, resourceStat, techPowers, technoRule, type ResourceKey,
} from "../state/tech";
import type { SheetSignals } from "../schema/sheet";
import { BODY_ROWS } from "./Armour";
import { AttackRoll } from "./Attacks";
import { rollCharacteristic } from "./Characteristics";
import { PhenomenaRoll } from "./Phenomena";
import { CompensationRoll, PsychicRoll, TechRoll } from "./Powers";
import { ProcessPill } from "./Processes";
import { CurrentResource } from "./ResourceField";
import { POWER_FIELD, TECH_FIELD, WEAPON_FIELD, modTitle, type FieldOwner } from "./ModdedField";
import { DamageLabel } from "./rollParts";
import { Difficulty } from "./skillParts";
import { SustainedList } from "./Sustain";

const PROFILE_LABELS = new Map(MELEE_PROFILES.map(o => [optionValue(o), optionLabel(o)]));

// The titles of the sections the viewer collapsed: the viewer's own, for every
// stat block, not the sheet's UI state, which the stat block keeps none of.
const COLLAPSED_KEY = "statblock_collapsed";

function readCollapsed(): string[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
        return Array.isArray(stored) ? stored.filter(t => typeof t === "string") : [];
    } catch {
        return [];
    }
}

const collapsedSections = signal<readonly string[]>(readCollapsed());

function toggleSection(title: string): void {
    const now = collapsedSections.peek();
    collapsedSections.value = now.includes(title) ? now.filter(t => t !== title) : [...now, title];
    try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedSections.value));
    } catch {
        // storage can be unavailable
    }
}

/**
 * A section of the block, collapsed by the button beside its title;
 * `buttons` sit at the right end of the title, where the content below never
 * moves them, and stay when it is collapsed.
 */
function Section({ title, buttons, children }: { title: string; buttons?: preact.ComponentChildren; children: preact.ComponentChildren }) {
    const collapsed = collapsedSections.value.includes(title);
    return (
        <section class={collapsed ? "stat-section collapsed" : "stat-section"}>
            <div class="stat-section-title">
                <h4>{title}</h4>
                <button type="button" class="stat-section-toggle" aria-expanded={!collapsed}
                    title={collapsed ? "Expand" : "Collapse"} aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
                    onClick={() => toggleSection(title)} />
                {buttons}
            </div>
            {!collapsed && children}
        </section>
    );
}

/** The characteristics; the whole cell of one rolls its test. */
function StatCharacteristics() {
    const sheet = useSheet();
    const unnatural = (key: string) => Number(valueAt(sheet.state, `characteristics.${key}.calculatedUnnatural`)) || 0;
    return (
        <Scope dataId="characteristics" class="stat-characteristics">
            {CHARACTERISTICS.map(({ key, label }) => (
                <Scope key={key} dataId={key} {...(sheet.preview
                    ? { class: "stat-characteristic", ...hoverTitle(() => characteristicSummary(sheet.state, key)) }
                    : {
                        class: "stat-characteristic rollable", onClick: () => rollCharacteristic(sheet, key, label),
                        ...hoverTitle(() => [`Test ${label}`, ...characteristicSummary(sheet.state, key)]),
                    })}>
                    <label>{key}</label>
                    <span class="stat-characteristic-value">
                        <span data-id="calculatedValue">{textAt(sheet.state, `characteristics.${key}.calculatedValue`)}</span>
                        {unnatural(key) > 0 && (
                            <span data-id="calculatedUnnatural" class="stat-unnatural" {...hoverTitle(() => unnaturalSummary(sheet.state, key))}>{unnatural(key)}</span>
                        )}
                    </span>
                </Scope>
            ))}
        </Scope>
    );
}

/** The figure of the Armour block, small and read-only: each part's total with its toughness bonus and super armour. */
function StatArmour({ armour }: { armour: ArmourComputeds }) {
    const { state } = useSheet();
    return (
        <Scope dataId="armour" class="stat-armour">
            <div class="stat-armour-mask" />
            {BODY_ROWS.map((row, i) => (
                <div key={i} class="stat-armour-row">
                    {row.map(({ key, label, hits }) => {
                        const part = armour.parts[key];
                        return (
                            // The marks' own titles cover the part's where they are.
                            <span key={key} data-id={key} class="stat-armour-part" {...hoverTitle(() => armourTotalSummary(state, armour, key))}>
                                <span>{label}</span>
                                <span class="stat-armour-total">
                                    <b data-id="total">{part.total.value}</b>
                                    <span class="stat-armour-marks">
                                        <span data-id="toughnessSuper" {...hoverTitle(() => toughnessSummary(state, armour))}>{part.toughnessSuper.value}</span>
                                        <span data-id="superArmourSub" {...hoverTitle(() => superArmourSummary(armour, key))}>{part.superArmourSub.value}</span>
                                    </span>
                                </span>
                                <span class="stat-armour-hits">({hits})</span>
                            </span>
                        );
                    })}
                </div>
            ))}
        </Scope>
    );
}

/** The wounds left of the maximum, and under them the ablative wounds left, which a hit takes first. */
function StatWounds({ armour }: { armour: ArmourComputeds }) {
    const { state } = useSheet();
    const max = numberAt(state, "armour.woundsMax");
    const ablative = armour.ablativeWounds.value;
    const { left, ablativeLeft } = woundsLeft(max, ablative, numberAt(state, "armour.woundsCur"));
    return (
        <Scope dataId="armour" class="stat-wounds">
            <div><b data-id="woundsRemaining">{left}</b>{" / "}<span data-id="woundsMax">{max}</span></div>
            {/* Its line is kept empty without them, so that nothing moves when they come. */}
            <div class="stat-ablative">
                {ablative > 0 && (
                    <span data-id="ablativeWounds" title={`Ablative wounds: ${ablativeLeft} of ${ablative} left`}>{`+${ablativeLeft} ablative`}</span>
                )}
            </div>
        </Scope>
    );
}

function StatFatigue() {
    const { state } = useSheet();
    return (
        <Scope dataId="fatigue" class="stat-fatigue">
            <NumberField field="fatigueCur" class="short" />
            {" / "}<span data-id="fatigueMax">{textAt(state, "fatigue.fatigueMax")}</span>
        </Scope>
    );
}

/** The armour, with the wounds, fatigue and movement beside it. */
function StatDefence() {
    const { state } = useSheet();
    const armour = useMemo(() => armourComputeds(state), [state]);
    return (
        <Section title="Armour">
            <div class="stat-defence">
                <StatArmour armour={armour} />
                <div class="stat-defence-side">
                    <div class="stat-pools">
                        <div class="stat-pool">
                            <h4>Wounds</h4>
                            <StatWounds armour={armour} />
                        </div>
                        <div class="stat-pool">
                            <h4>Fatigue</h4>
                            <StatFatigue />
                        </div>
                    </div>
                    <h4>Movement</h4>
                    <StatMovement />
                </div>
            </div>
        </Section>
    );
}

const MOVES = [["moveHalf", "Half"], ["moveFull", "Full"], ["moveCharge", "Charge"], ["moveRun", "Run"]] as const;

function StatMovement() {
    const { state } = useSheet();
    return (
        <Scope as="table" dataId="movement" class="stat-movement">
            <thead>
                <tr>{MOVES.map(([field, label]) => <th key={field}>{label}</th>)}</tr>
            </thead>
            <tbody>
                <tr>
                    {MOVES.map(([field]) => (
                        <td key={field} data-id={field} {...hoverTitle(() => movementSummary(state, field))}>{textAt(state, `movement.${field}`)}</td>
                    ))}
                </tr>
            </tbody>
        </Scope>
    );
}

/** A skill: its name, cut short with the whole on hover, and difficulty, which rolls the test. */
function StatSkill({ rowPath, name }: { rowPath: string; name: string }) {
    return (
        <>
            <span class="stat-skill-name" title={name}>{name}</span>
            <Difficulty rowPath={rowPath} label={() => name} />
        </>
    );
}

const trained = (state: SheetSignals, table: string, rows: readonly SkillRow[]) => rows.filter(row => valueAt(state, `${table}.${row.key}.plus0`));

/** The trained skills of a table: plus0 and above. */
function TrainedSkills({ table, rows, editableName }: { table: string; rows: readonly SkillRow[]; editableName: boolean }) {
    const { state } = useSheet();
    return (
        <Scope dataId={table} class="stat-skill-table">
            {trained(state, table, rows).map(row => {
                const rowPath = `${table}.${row.key}`;
                // A row of the right column never named shows its group, as "Trade".
                const name = editableName ? textAt(state, `${rowPath}.name`) || row.group || "" : row.group ? `${row.group} (${row.label})` : row.label;
                return <Scope key={row.key} dataId={row.key} class="stat-skill"><StatSkill rowPath={rowPath} name={name} /></Scope>;
            })}
        </Scope>
    );
}

function StatSkills() {
    const { state, stats } = useSheet();
    const grid = "customSkills.list.items";
    const custom = idsInOrder(state, grid).filter(id => textAt(state, `${grid}.${id}.name`) && valueAt(state, `${grid}.${id}.plus0`));
    if (!custom.length && !trained(state, "skillsLeft", stats.skillsLeft).length && !trained(state, "skillsRight", stats.skillsRight).length) return null;
    return (
        <Section title="Skills">
            <div class="stat-skills">
                <TrainedSkills table="skillsLeft" rows={stats.skillsLeft} editableName={false} />
                <TrainedSkills table="skillsRight" rows={stats.skillsRight} editableName />
                <Scope dataId={grid} class="stat-skill-table">
                    {custom.map(id => (
                        <Scope key={id} dataId={id} class="stat-skill">
                            <StatSkill rowPath={`${grid}.${id}`} name={textAt(state, `${grid}.${id}.name`)} />
                        </Scope>
                    ))}
                </Scope>
            </div>
        </Section>
    );
}

/**
 * Damage, pen and type of the attack, melee profile or power at `itemPath`;
 * the damage label rolls the damage.
 */
function DamageLine({ owner, itemPath, label }: { owner: FieldOwner; itemPath: string; label: () => string }) {
    const { state } = useSheet();
    const damage = statAt(state, owner.damage, itemPath, "damage").text;
    const pen = statAt(state, owner.damage, itemPath, "pen").text;
    return (
        <span class="stat-damage">
            <DamageLabel owner={owner.damage} itemPath={itemPath} label={label}>Damage</DamageLabel>
            {" "}<b data-id="damage" {...hoverTitle(() => modTitle(state, owner, itemPath, "damage"))}>{damage || "—"}</b>
            {" "}{textAt(state, `${itemPath}.damageType`)}
            {pen && <> · Pen <b data-id="pen" {...hoverTitle(() => modTitle(state, owner, itemPath, "pen"))}>{pen}</b></>}
        </span>
    );
}

// The widths of the attack roll dropdowns in the sheet, more than the column of the stat block has;
// the other dropdowns are as wide as their content.
const ATTACK_DROPDOWN_WIDTHS = [[".stat-ranged", 870], [".stat-melee", 985]] as const;
const DROPDOWN_MARGIN = 8;

/**
 * Places an open dropdown under the element that holds it, or over it
 * without room below, its right edge at that element's: wider than the
 * block, it goes over the columns on the left.
 */
function placeDropdown(menu: HTMLElement): void {
    const at = menu.parentElement!.getBoundingClientRect();
    const room = innerWidth - 2 * DROPDOWN_MARGIN;
    const fixed = ATTACK_DROPDOWN_WIDTHS.find(([selector]) => menu.closest(selector))?.[1];
    // Measured at the left edge: placed further right, a dropdown without a width would shrink to the room left.
    if (fixed === undefined) Object.assign(menu.style, { left: "0px", width: "" });
    const width = Math.min(fixed ?? menu.offsetWidth, room);
    const below = at.bottom + 4;
    const top = below + menu.offsetHeight <= innerHeight - DROPDOWN_MARGIN
        ? below
        : Math.max(DROPDOWN_MARGIN, at.top - 4 - menu.offsetHeight);
    Object.assign(menu.style, {
        top: `${top}px`, left: `${Math.max(DROPDOWN_MARGIN, at.right - width)}px`,
        width: fixed === undefined ? "" : `${width}px`, maxWidth: `${room}px`,
    });
}

/**
 * Places the open dropdowns of the block: they are fixed, as the column
 * scrolls and would clip them. Some open in components of the sheet that keep
 * their state, as the phenomena, so a change of the block's elements or
 * classes tells when one opens.
 */
function usePlacedDropdowns(block: RefObject<HTMLElement>): void {
    useLayoutEffect(() => {
        const root = block.current!;
        const place = () => root.querySelectorAll<HTMLElement>(".roll-dropdown.visible").forEach(placeDropdown);
        const observer = new MutationObserver(place);
        observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
        // A scroll of the column moves the anchors; scroll does not bubble, so it is caught on the way down.
        document.addEventListener("scroll", place, true);
        addEventListener("resize", place);
        return () => {
            observer.disconnect();
            document.removeEventListener("scroll", place, true);
            removeEventListener("resize", place);
        };
    }, []);
}

interface AttackProps {
    itemId: string;
    grid: string;
    domain: "ranged" | "melee";
}

/** The attack's name, which opens the roll dropdown of the sheet over the block when the attack has a roll. */
function StatAttack({ itemId, grid, domain }: AttackProps) {
    const { state, preview } = useSheet();
    const path = `${grid}.${itemId}`;
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const name = textAt(state, `${path}.name`) || (domain === "ranged" ? "Ranged Attack" : "Melee Attack");
    const rollable = !preview && valueAt(state, `${path}.roll.baseSelect`) !== undefined;
    const special = textAt(state, `${path}.special`);
    const shield = domain === "melee" && valueAt(state, `${path}.group`) === "primary (shield)";

    return (
        <Scope dataId={itemId} class={`stat-attack stat-${domain}`} elRef={ref}>
            <div class="stat-attack-name">
                {rollable
                    ? <label class={dropdown.open ? "rollable active" : "rollable"} onClick={dropdown.toggle}>{name}</label>
                    : <span>{name}</span>}
                {rollable && (domain === "ranged"
                    ? <AttackRoll path={path} open={dropdown.open} close={dropdown.close} columns={RANGED_ROLL_COLUMNS} baseSelects={RANGED_BASE_SELECTS} domain="ranged" />
                    : <AttackRoll path={path} open={dropdown.open} close={dropdown.close} columns={MELEE_ROLL_COLUMNS} baseSelects={MELEE_BASE_SELECTS} domain="melee" class="melee" />)}
            </div>
            {shield && <StatShield path={path} />}
            {domain === "ranged" ? (
                <>
                    <div class="stat-line">
                        <DamageLine owner={WEAPON_FIELD} itemPath={path} label={() => name} />
                        {special && <span class="stat-special">{special}</span>}
                    </div>
                    <div class="stat-line">
                        <span>RoF {textAt(state, `${path}.rofSingle`) || "—"}/{textAt(state, `${path}.rofShort`) || "—"}/{textAt(state, `${path}.rofLong`) || "—"}</span>
                        <span class="stat-clip">Clip <TextField field="clipCur" class="shorter-input" /> / {textAt(state, `${path}.clipMax`)}</span>
                    </div>
                </>
            ) : <MeleeProfiles path={path} name={name} />}
        </Scope>
    );
}

/**
 * The shield of the melee attack at `path`: its AP, the arm that holds it and
 * whether it is equipped and defensive, which the gamemaster switches in a fight.
 */
function StatShield({ path }: { path: string }) {
    const { state } = useSheet();
    return (
        <Scope dataId="shield" class="stat-line stat-shield">
            <span>Shield AP <b data-id="ap">{textAt(state, `${path}.shield.ap`) || "0"}</b></span>
            <label>Arm <Select field="arm" options={SHIELD_ARMS} /></label>
            <label>Equipped <Checkbox field="equipped" class="custom" /></label>
            <label>Defensive <Checkbox field="defensive" class="custom" /></label>
        </Scope>
    );
}

/** A line for each profile of the melee attack at `path`. */
function MeleeProfiles({ path, name }: { path: string; name: string }) {
    const { state } = useSheet();
    const tabs = `${path}.tabs.items`;
    return (
        <Scope dataId="tabs.items">
            {idsInOrder(state, tabs).map(tabId => {
                const profile = textAt(state, `${tabs}.${tabId}.profile`);
                const special = textAt(state, `${tabs}.${tabId}.special`);
                return (
                    <Scope key={tabId} dataId={tabId} class="stat-line stat-profile">
                        {/* An empty profile is Other; "no" is no profile at all. */}
                        {profile !== "no" && <span class="stat-profile-name">{PROFILE_LABELS.get(profile) ?? profile}</span>}
                        <DamageLine owner={WEAPON_FIELD} itemPath={`${tabs}.${tabId}`} label={() => profileLabel(name, String(peekAt(state, `${tabs}.${tabId}.profile`) ?? ""))} />
                        {special && <span class="stat-special">{special}</span>}
                    </Scope>
                );
            })}
        </Scope>
    );
}

function StatAttacks() {
    const { state } = useSheet();
    const ranged = "rangedAttacks.list.items";
    const melee = "meleeAttacks.list.items";
    const rangedIds = idsInOrder(state, ranged);
    const meleeIds = idsInOrder(state, melee);
    if (!rangedIds.length && !meleeIds.length) return null;
    return (
        <Section title="Attacks">
            <Scope dataId={ranged} class="stat-attacks">
                {rangedIds.map(id => <StatAttack key={id} itemId={id} grid={ranged} domain="ranged" />)}
            </Scope>
            <Scope dataId={melee} class="stat-attacks">
                {meleeIds.map(id => <StatAttack key={id} itemId={id} grid={melee} domain="melee" />)}
            </Scope>
        </Section>
    );
}

/**
 * A power at `path`, `id` in its grid: its name opens the roll
 * dropdown of the sheet over the block when it has a roll; then the PR its
 * damage counts or its price, and what of it counts in a fight.
 */
function StatPower({ kind, id, path }: { kind: "psychic" | "tech"; id: string; path: string }) {
    const { state, preview } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const psychic = kind === "psychic";
    const name = textAt(state, `${path}.name`) || (psychic ? "Psychic Power" : "Tech Power");
    const rollable = !preview && valueAt(state, `${path}.roll.testOption`) !== undefined;
    const Roll = psychic ? PsychicRoll : TechRoll;
    const owner = psychic ? POWER_FIELD : TECH_FIELD;
    const pr = psychic ? powerPR(state, path) : 0;
    const price = textAt(state, `${path}.price`);
    const action = textAt(state, `${path}.action`);
    const range = textAt(state, `${path}.range`);
    const special = textAt(state, `${path}.special`);
    const hasDamage = statAt(state, owner.damage, path, "damage").text !== "";

    return (
        <Scope dataId={id} class={`stat-power stat-${kind}`} elRef={ref}>
            <div class="stat-power-name">
                {rollable
                    ? <label class={dropdown.open ? "rollable active" : "rollable"} onClick={dropdown.toggle}>{name}</label>
                    : <span>{name}</span>}
                {/* Rendered only while open, as in the sheet. */}
                {rollable && dropdown.open && <Roll path={path} close={dropdown.close} />}
                {psychic
                    ? <span class="stat-muted" data-id="pr" title="The PR its damage counts: that of its last cast, of a normal cast before one">PR {pr}</span>
                    : price && <span class="stat-muted" data-id="price" title="Price">{price}</span>}
                {!psychic && <ProcessPill path={path} />}
            </div>
            {(action || range || hasDamage) && (
                <div class="stat-line">
                    {action && <span data-id="action">{action}</span>}
                    {range && <span data-id="range">Range {range}</span>}
                    {hasDamage && <DamageLine owner={owner} itemPath={path} label={() => (psychic ? `${name}, PR ${pr}` : name)} />}
                </div>
            )}
            {special && <div class="stat-line stat-special">{special}</div>}
        </Scope>
    );
}

/** The powers of a block, tab by tab, in the Scope of the block. */
function StatPowerTabs({ kind, powers }: { kind: "psychic" | "tech"; powers: { path: string; tabId: string }[] }) {
    const tabs = [...new Set(powers.map(p => p.tabId))];
    return (
        <Scope dataId="tabs.items">
            {tabs.map(tabId => (
                <Scope key={tabId} dataId={`${tabId}.powers.items`}>
                    {powers.filter(p => p.tabId === tabId).map(({ path }) => (
                        <StatPower key={path} kind={kind} id={path.slice(path.lastIndexOf(".") + 1)} path={path} />
                    ))}
                </Scope>
            ))}
        </Scope>
    );
}

/**
 * The psychic powers under what a cast needs of the psykana bar: the current
 * PR, the most a kick adds and the sustained powers; the phenomena by the title.
 */
function StatPsykana() {
    const { state } = useSheet();
    const powers = psychicPowers(state);
    if (!powers.length) return null;
    return (
        <Section title="Psychic powers" buttons={<Scope dataId="psykana"><PhenomenaRoll /></Scope>}>
            <Scope dataId="psykana" class="stat-powers">
                <div class="stat-line stat-power-bar">
                    <span title="The base PR less what the sustained powers take">Current PR <b data-id="effectivePR">{numberAt(state, "psykana.effectivePR")}</b></span>
                    <span title="The most PR a kick adds">Max Push <b data-id="maxPush">{numberAt(state, "psykana.maxPush")}</b></span>
                </div>
                <SustainedList linked={false} />
                <StatPowerTabs kind="psychic" powers={powers} />
            </Scope>
        </Section>
    );
}

/** The current cognition or energy, typed, its maximum and what the start of a turn restores. */
function StatResource({ label, field, max, restore }: {
    label: string; field: "currentCognition" | "currentEnergy"; max: ResourceKey; restore: ResourceKey;
}) {
    const { state } = useSheet();
    const restored = resourceStat(state, restore).total;
    return (
        <label class="stat-resource">
            {label} <CurrentResource field={field} max={max} /> / {resourceStat(state, max).total}
            {restored > 0 && <span class="stat-muted">{`+${restored} a turn`}</span>}
        </label>
    );
}

/**
 * The tech powers under what an activation needs of the techno arcana bar:
 * cognition and energy and what the Processes cost a turn; the
 * Compensation Roll by the title, as the sheet has it always.
 */
function StatTechnoArcana() {
    const { state, preview } = useSheet();
    const powers = techPowers(state);
    if (!powers.length) return null;
    // With none held too, so that the first Process moves nothing.
    const counted = technoRule(state, "processes");
    return (
        <Section title="Tech powers" buttons={!preview && <Scope dataId="technoArcana"><CompensationRoll /></Scope>}>
            <Scope dataId="technoArcana" class="stat-powers">
                <div class="stat-line stat-power-bar">
                    <StatResource label="Cognition" field="currentCognition" max="cognitionMax" restore="cognitionRestore" />
                    <StatResource label="Energy" field="currentEnergy" max="energyMax" restore="energyRestore" />
                    {counted && <span data-id="processCost" title="What the Processes cost each turn">{`Processes ${costText(processCost(state).total)} a turn`}</span>}
                </div>
                <StatPowerTabs kind="tech" powers={powers} />
            </Scope>
        </Section>
    );
}

const CONDITIONS = "conditions.list.items";

/**
 * A new condition at the end of the list, where the sheet's "+ Add" of the
 * last column puts it; picking a suggestion lays the collection's entry over it.
 */
function AddCondition() {
    const { state, autocomplete, actions } = useSheet();
    const { ids, layouts } = useItemIds(CONDITIONS);
    const inputRef = useRef<HTMLInputElement>(null);

    const add = (name: string): string => {
        const itemId = `conditions-${nanoid()}`;
        const cols = columnsFromLayout(gridSpecOf(schemaOf(state), CONDITIONS)?.columns ?? 1, layouts, ids);
        createAtEnd(actions, CONDITIONS, cols, cols.length - 1, itemId, { ...conditionFactory(), name });
        inputRef.current!.value = "";
        return `${CONDITIONS}.${itemId}`;
    };
    const pick = (result: AutocompleteResult) => {
        autocomplete?.close();
        actions.autocompleteApply(add(result.name), "conditions", result.name);
    };
    useAutocompleteInput(inputRef, "conditions", pick);

    // Preact's listener runs before the autocomplete's, which picks the active option.
    const onKeyDown = (e: KeyboardEvent) => {
        const input = e.currentTarget as HTMLInputElement;
        const s = autocomplete?.suggestions.peek();
        if (s?.input === input && s.active >= 0) return;
        if (e.key === "Enter" && input.value.trim()) {
            e.preventDefault();
            autocomplete?.close(input);
            add(input.value.trim());
        } else if (e.key === "Escape") {
            input.value = "";
        }
    };

    return (
        <div class="stat-add-condition">
            <input type="text" ref={inputRef} placeholder="Add condition…" onKeyDown={onKeyDown} />
            {autocomplete && <AutocompleteDropdown autocomplete={autocomplete} inputRef={inputRef} renderOption={nameOption} onPick={pick} />}
        </div>
    );
}

/**
 * The conditions, as the sheet's items, in a grid; the viewer who edits the
 * sheet adds them in the cell after the last, only the sheet removes them.
 */
function StatConditions() {
    const { state, canEdit } = useSheet();
    const ids = idsInOrder(state, CONDITIONS);
    if (!ids.length && !canEdit) return null;
    return (
        <Section title="Conditions">
            <Scope dataId={CONDITIONS} class="stat-conditions">
                {ids.map(id => {
                    const name = textAt(state, `${CONDITIONS}.${id}.name`);
                    return (
                        <Scope key={id} dataId={id} class={valueAt(state, `${CONDITIONS}.${id}.enabled`) ? "stat-condition" : "stat-condition disabled"}>
                            <label class="stat-condition-name" {...hoverTitle(() => [name, ...conditionSummary(state, id)])}>
                                <Checkbox field="enabled" class="custom" />
                                <span>{name}</span>
                            </label>
                            <label title="Stack count">X:<NumberField field="stacks" class="short" min="0" /></label>
                        </Scope>
                    );
                })}
                {canEdit && <AddCondition />}
            </Scope>
        </Section>
    );
}

function StatTrackers() {
    const { state } = useSheet();
    const grid = "resourceTrackers.list.items";
    const ids = idsInOrder(state, grid);
    if (!ids.length) return null;
    return (
        <Section title="Trackers">
            <Scope dataId={grid} class="stat-trackers">
                {ids.map(id => (
                    <Scope key={id} dataId={id} class="stat-tracker">
                        <span>{textAt(state, `${grid}.${id}.name`)}</span>
                        <NumberField field="value" class="short" />
                    </Scope>
                ))}
            </Scope>
        </Section>
    );
}

const named = (state: SheetSignals, grid: string) => idsInOrder(state, grid).filter(id => textAt(state, `${grid}.${id}.name`));

/** Names of a list of named descriptions; the description shows on hover. */
function Chips({ grid }: { grid: string }) {
    const { state } = useSheet();
    return (
        <Scope dataId={grid} class="stat-chips">
            {named(state, grid).map(id => (
                <span key={id} data-id={id} class="stat-chip" title={textAt(state, `${grid}.${id}.description`) || undefined}>
                    {textAt(state, `${grid}.${id}.name`)}
                </span>
            ))}
        </Scope>
    );
}

function StatTraits() {
    const { state } = useSheet();
    if (!named(state, "traits.list.items").length && !named(state, "talents.list.items").length) return null;
    return (
        <Section title="Traits and talents">
            <Chips grid="traits.list.items" />
            <Chips grid="talents.list.items" />
        </Section>
    );
}

/** The stat block of a Black Crusade sheet; a section with nothing in it is left out. */
export function StatBlock() {
    const ref = useRef<HTMLDivElement>(null);
    usePlacedDropdowns(ref);
    return (
        <div class="stat-block" ref={ref}>
            <StatCharacteristics />
            <StatDefence />
            <StatSkills />
            <StatTrackers />
            <StatConditions />
            <StatAttacks />
            <StatPsykana />
            <StatTechnoArcana />
            <StatTraits />
        </div>
    );
}
