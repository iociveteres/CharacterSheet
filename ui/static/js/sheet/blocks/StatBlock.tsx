// The stat block of the encounter window and the bestiary (_prd/gm_mode,
// stages 2 and 6): the sheet short, for a fight. It reuses the rolls of the
// blocks, which work on a read-only sheet too, as in the full sheet, and
// edits the fields of a fight in place: ammo, a shield's defensive mode,
// conditions, trackers, fatigue, cognition and energy; it adds conditions too.
// It keeps no UI state of the sheet: collapsing an item here would collapse
// it in the sheet.
import type { RefObject } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { nanoid } from "nanoid";
import { AutocompleteDropdown, useAutocompleteInput } from "../components/AutocompleteField";
import { nameOption } from "../components/autocompleteOptions";
import { columnsFromLayout, createAtEnd } from "../components/columns";
import { useSheet, type AutocompleteResult } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { conditionFactory } from "../factories/condition";
import {
    CHARACTERISTICS, MELEE_BASE_SELECTS, MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_BASE_SELECTS, RANGED_ROLL_COLUMNS,
    SHIELD_ARMS, optionLabel, optionValue, type SkillRow,
} from "../schema/constants";
import { armourComputeds } from "../state/armour";
import { gridSpecOf } from "../state/fromJson";
import { schemaOf } from "../state/state";
import { POWER_DAMAGE, TECH_DAMAGE, WEAPON_DAMAGE, powerPR, profileLabel, statAt, type DamageOwner } from "../state/damage";
import { idsInOrder } from "../state/gridOrder";
import { psychicPowers } from "../state/psychic";
import { peekAt, numberAt, textAt, valueAt } from "../state/sync";
import {
    compensationDue, costText, processCost, processes, resourceStat, techPowers, techTraitsAt, technoRule, type ResourceKey,
} from "../state/tech";
import type { SheetSignals } from "../schema/sheet";
import { BODY_ROWS } from "./Armour";
import { AttackRoll } from "./Attacks";
import { rollCharacteristic } from "./Characteristics";
import { PhenomenaRoll } from "./Phenomena";
import { CompensationRoll, PsychicRoll, TechRoll } from "./Powers";
import { ProcessPill } from "./Processes";
import { CurrentResource } from "./ResourceField";
import { DamageLabel } from "./rollParts";
import { Difficulty } from "./skillParts";
import { SustainedList } from "./Sustain";

const PROFILE_LABELS = new Map(MELEE_PROFILES.map(o => [optionValue(o), optionLabel(o)]));
const ARM_LABELS = new Map(SHIELD_ARMS.map(o => [optionValue(o), optionLabel(o)]));

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
    return (
        <section class="stat-section">
            <h4>{title}</h4>
            {children}
        </section>
    );
}

function StatCharacteristics() {
    const sheet = useSheet();
    const unnatural = (key: string) => Number(valueAt(sheet.state, `characteristics.${key}.calculatedUnnatural`)) || 0;
    return (
        <Scope dataId="characteristics" class="stat-characteristics">
            {CHARACTERISTICS.map(({ key, label }) => (
                <Scope key={key} dataId={key} class="stat-characteristic">
                    <label class="rollable" title={`Test ${label}`} onClick={() => rollCharacteristic(sheet, key, label)}>{key}</label>
                    <span data-id="calculatedValue">{textAt(sheet.state, `characteristics.${key}.calculatedValue`)}</span>
                    {unnatural(key) > 0 && <span data-id="calculatedUnnatural" class="stat-unnatural">({unnatural(key)})</span>}
                </Scope>
            ))}
        </Scope>
    );
}

type Armour = ReturnType<typeof armourComputeds>;

/** The figure of the Armour block, small and read-only: each part's total with its toughness bonus and super armour. */
function StatArmour({ armour }: { armour: Armour }) {
    return (
        <Scope dataId="armour" class="stat-armour">
            <div class="stat-armour-mask" />
            {BODY_ROWS.map((row, i) => (
                <div key={i} class="stat-armour-row">
                    {row.map(({ key, label, hits }) => {
                        const part = armour.parts[key];
                        return (
                            <span key={key} data-id={key} class="stat-armour-part">
                                <span>{label}</span>
                                <span class="stat-armour-total">
                                    <b data-id="total">{part.total.value}</b>
                                    <span class="stat-armour-marks">
                                        <span data-id="toughnessSuper" title="Toughness bonus">{part.toughnessSuper.value}</span>
                                        <span data-id="superArmourSub" title="Super armour">{part.superArmourSub.value}</span>
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

/** The wounds left of the maximum, which ablative wounds raise, as the Armour block counts them. */
function StatWounds({ armour }: { armour: Armour }) {
    const { state } = useSheet();
    const ablative = armour.ablativeWounds.value;
    return (
        <Scope dataId="armour" class="stat-wounds">
            <b data-id="woundsRemaining">{armour.woundsRemaining.value}</b>
            {" / "}<span data-id="woundsMax">{(Number(valueAt(state, "armour.woundsMax")) || 0) + ablative}</span>
            {ablative > 0 && <span class="stat-muted"> ({ablative} ablative)</span>}
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
                <tr>{MOVES.map(([field]) => <td key={field} data-id={field}>{textAt(state, `movement.${field}`)}</td>)}</tr>
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
                const name = editableName ? textAt(state, `${rowPath}.name`) : row.group ? `${row.group} (${row.label})` : row.label;
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
function DamageLine({ owner, itemPath, label }: { owner: DamageOwner; itemPath: string; label: () => string }) {
    const { state } = useSheet();
    const damage = statAt(state, owner, itemPath, "damage").text;
    const pen = statAt(state, owner, itemPath, "pen").text;
    return (
        <span class="stat-damage">
            <DamageLabel owner={owner} itemPath={itemPath} label={label}>Damage</DamageLabel>
            {" "}<b data-id="damage">{damage || "—"}</b> {textAt(state, `${itemPath}.damageType`)}
            {pen && <> · Pen <b data-id="pen">{pen}</b></>}
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
    const { state } = useSheet();
    const path = `${grid}.${itemId}`;
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const name = textAt(state, `${path}.name`) || (domain === "ranged" ? "Ranged Attack" : "Melee Attack");
    const rollable = valueAt(state, `${path}.roll.baseSelect`) !== undefined;
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
                        <DamageLine owner={WEAPON_DAMAGE} itemPath={path} label={() => name} />
                    </div>
                    <div class="stat-line">
                        <span>RoF {textAt(state, `${path}.rofSingle`) || "—"}/{textAt(state, `${path}.rofShort`) || "—"}/{textAt(state, `${path}.rofLong`) || "—"}</span>
                        <span class="stat-clip">Clip <TextField field="clipCur" class="shorter-input" /> / {textAt(state, `${path}.clipMax`)}</span>
                    </div>
                    {special && <div class="stat-line stat-special">{special}</div>}
                </>
            ) : <MeleeProfiles path={path} name={name} />}
        </Scope>
    );
}

/**
 * The shield of the melee attack at `path`: its AP, the arm that holds it and
 * whether it is defensive, which the gamemaster switches in a fight.
 */
function StatShield({ path }: { path: string }) {
    const { state } = useSheet();
    // An arm never picked is the left one, as the armour counts it.
    const arm = textAt(state, `${path}.shield.arm`) || "left";
    return (
        <Scope dataId="shield" class="stat-line stat-shield">
            <span>Shield AP <b data-id="ap">{textAt(state, `${path}.shield.ap`) || "0"}</b></span>
            <span data-id="arm">{ARM_LABELS.get(arm) ?? arm} arm</span>
            <label>Defensive <Checkbox field="defensive" class="custom" /></label>
            {!valueAt(state, `${path}.shield.equipped`) && <span class="stat-special">not equipped</span>}
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
                        {profile && profile !== "no" && <span class="stat-profile-name">{PROFILE_LABELS.get(profile) ?? profile}</span>}
                        <DamageLine owner={WEAPON_DAMAGE} itemPath={`${tabs}.${tabId}`} label={() => profileLabel(name, String(peekAt(state, `${tabs}.${tabId}.profile`) ?? ""))} />
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
    const { state } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const psychic = kind === "psychic";
    const name = textAt(state, `${path}.name`) || (psychic ? "Psychic Power" : "Tech Power");
    const rollable = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const Roll = psychic ? PsychicRoll : TechRoll;
    const owner = psychic ? POWER_DAMAGE : TECH_DAMAGE;
    const pr = psychic ? powerPR(state, path) : 0;
    const price = textAt(state, `${path}.price`);
    const action = textAt(state, `${path}.action`);
    const range = textAt(state, `${path}.range`);
    const special = textAt(state, `${path}.special`);
    const hasDamage = statAt(state, owner, path, "damage").text !== "";

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
 * PR, the most a kick adds, the phenomena and the sustained powers.
 */
function StatPsykana() {
    const { state } = useSheet();
    const powers = psychicPowers(state);
    if (!powers.length) return null;
    return (
        <Section title="Psychic powers">
            <Scope dataId="psykana" class="stat-powers">
                <div class="stat-line stat-power-bar">
                    <span title="The base PR less what the sustained powers take">Current PR <b data-id="effectivePR">{numberAt(state, "psykana.effectivePR")}</b></span>
                    <span title="The most PR a kick adds">Max Push <b data-id="maxPush">{numberAt(state, "psykana.maxPush")}</b></span>
                    <PhenomenaRoll />
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
 * cognition and energy, what the Processes cost a turn and, with a
 * Compensator power, the Compensation Roll.
 */
function StatTechnoArcana() {
    const { state } = useSheet();
    const powers = techPowers(state);
    if (!powers.length) return null;
    const held = technoRule(state, "processes") && processes(state).powers.length > 0;
    const compensator = powers.some(({ path }) => techTraitsAt(state, path).compensator !== undefined) || compensationDue(state) !== null;
    return (
        <Section title="Tech powers">
            <Scope dataId="technoArcana" class="stat-powers">
                <div class="stat-line stat-power-bar">
                    <StatResource label="Cognition" field="currentCognition" max="cognitionMax" restore="cognitionRestore" />
                    <StatResource label="Energy" field="currentEnergy" max="energyMax" restore="energyRestore" />
                    {held && <span data-id="processCost" title="What the Processes cost each turn">{`Processes ${costText(processCost(state).total)} a turn`}</span>}
                    {compensator && <CompensationRoll />}
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

/** The conditions; the viewer who edits the sheet adds them here too, only the sheet removes them. */
function StatConditions() {
    const { state, canEdit } = useSheet();
    const ids = idsInOrder(state, CONDITIONS);
    if (!ids.length && !canEdit) return null;
    return (
        <Section title="Conditions">
            <Scope dataId={CONDITIONS} class="stat-conditions">
                {ids.map(id => (
                    <Scope key={id} dataId={id} class={valueAt(state, `${CONDITIONS}.${id}.enabled`) ? "stat-condition" : "stat-condition disabled"}>
                        <label>
                            <Checkbox field="enabled" class="custom" />
                            <span>{textAt(state, `${CONDITIONS}.${id}.name`)}</span>
                        </label>
                        <label title="Stack count">X <NumberField field="stacks" class="short" min="0" /></label>
                    </Scope>
                ))}
            </Scope>
            {canEdit && <AddCondition />}
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
            <StatAttacks />
            <StatPsykana />
            <StatTechnoArcana />
            <StatTrackers />
            <StatConditions />
            <StatTraits />
        </div>
    );
}
