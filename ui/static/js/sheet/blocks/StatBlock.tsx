// The stat block of the encounter window (_prd/gm_mode, stage 2): the sheet
// short, for a fight. It reuses the rolls of the blocks and edits the fields
// of a fight in place: ammo, conditions, trackers, fatigue. It keeps no UI
// state of the sheet: collapsing an item here would collapse it in the sheet.
import { useMemo, useRef } from "preact/hooks";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import {
    BODY_PARTS, CHARACTERISTICS, MELEE_BASE_SELECTS, MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_BASE_SELECTS,
    RANGED_ROLL_COLUMNS, optionLabel, optionValue, type SkillRow,
} from "../schema/constants";
import { armourComputeds } from "../state/armour";
import { WEAPON_DAMAGE, profileLabel, statAt } from "../state/damage";
import { idsInOrder } from "../state/gridOrder";
import { peekAt, textAt, valueAt } from "../state/sync";
import type { SheetSignals } from "../schema/sheet";
import { AttackRoll } from "./Attacks";
import { rollCharacteristic } from "./Characteristics";
import { DamageLabel } from "./rollParts";
import { Difficulty } from "./skillParts";

const PROFILE_LABELS = new Map(MELEE_PROFILES.map(o => [optionValue(o), optionLabel(o)]));

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
                    {sheet.canEdit
                        ? <label class="rollable" title={`Test ${label}`} onClick={() => rollCharacteristic(sheet, key, label)}>{key}</label>
                        : <label title={label}>{key}</label>}
                    <span data-id="calculatedValue">{textAt(sheet.state, `characteristics.${key}.calculatedValue`)}</span>
                    {unnatural(key) > 0 && <span data-id="calculatedUnnatural" class="stat-unnatural">({unnatural(key)})</span>}
                </Scope>
            ))}
        </Scope>
    );
}

function StatArmour() {
    const { state } = useSheet();
    const armour = useMemo(() => armourComputeds(state), [state]);
    return (
        <Scope dataId="armour" class="stat-armour">
            {BODY_PARTS.map(({ key, label }) => (
                <span key={key} data-id={key} class="stat-armour-part">
                    {label} <b data-id="total">{armour.parts[key].total.value}</b>
                </span>
            ))}
        </Scope>
    );
}

const MOVES = [["moveHalf", "Half"], ["moveFull", "Full"], ["moveCharge", "Charge"], ["moveRun", "Run"]] as const;

function StatMovement() {
    const { state } = useSheet();
    return (
        <Scope dataId="movement" class="stat-movement">
            {MOVES.map(([field, label]) => (
                <span key={field}>{label} <b data-id={field}>{textAt(state, `movement.${field}`)}</b></span>
            ))}
        </Scope>
    );
}

/** A skill: its name and difficulty, which rolls the test when the sheet can be rolled. */
function StatSkill({ rowPath, name }: { rowPath: string; name: string }) {
    const { canEdit } = useSheet();
    return (
        <>
            <span class="stat-skill-name">{name}</span>
            {canEdit ? <Difficulty rowPath={rowPath} label={() => name} /> : <ReadonlyField field="difficulty" class="short" />}
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
 * Damage, pen and type of the attack or melee profile at `itemPath`; the
 * damage label rolls the damage when the sheet can be rolled.
 */
function DamageLine({ itemPath, label }: { itemPath: string; label: () => string }) {
    const { state, canEdit } = useSheet();
    const damage = statAt(state, WEAPON_DAMAGE, itemPath, "damage").text;
    const pen = statAt(state, WEAPON_DAMAGE, itemPath, "pen").text;
    return (
        <span class="stat-damage">
            {canEdit ? <DamageLabel owner={WEAPON_DAMAGE} itemPath={itemPath} label={label}>Damage</DamageLabel> : <span>Damage</span>}
            {" "}<b data-id="damage">{damage || "—"}</b> {textAt(state, `${itemPath}.damageType`)}
            {pen && <> · Pen <b data-id="pen">{pen}</b></>}
        </span>
    );
}

interface AttackProps {
    itemId: string;
    grid: string;
    domain: "ranged" | "melee";
}

/** The attack's name, which opens the roll dropdown of the sheet when the sheet can be rolled. */
function StatAttack({ itemId, grid, domain }: AttackProps) {
    const { state, canEdit } = useSheet();
    const path = `${grid}.${itemId}`;
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const name = textAt(state, `${path}.name`) || (domain === "ranged" ? "Ranged Attack" : "Melee Attack");
    const rollable = canEdit && valueAt(state, `${path}.roll.baseSelect`) !== undefined;
    const special = textAt(state, `${path}.special`);

    return (
        <Scope dataId={itemId} class={`stat-attack stat-${domain}`} elRef={ref}>
            <div class="stat-attack-name">
                {rollable
                    ? <label class={dropdown.open ? "rollable active" : "rollable"} onClick={dropdown.toggle}>{name}</label>
                    : <span>{name}</span>}
            </div>
            {rollable && (domain === "ranged"
                ? <AttackRoll path={path} open={dropdown.open} close={dropdown.close} columns={RANGED_ROLL_COLUMNS} baseSelects={RANGED_BASE_SELECTS} domain="ranged" />
                : <AttackRoll path={path} open={dropdown.open} close={dropdown.close} columns={MELEE_ROLL_COLUMNS} baseSelects={MELEE_BASE_SELECTS} domain="melee" class="melee" />)}
            {domain === "ranged" ? (
                <>
                    <div class="stat-line">
                        <DamageLine itemPath={path} label={() => name} />
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
                        <DamageLine itemPath={`${tabs}.${tabId}`} label={() => profileLabel(name, String(peekAt(state, `${tabs}.${tabId}.profile`) ?? ""))} />
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

function StatConditions() {
    const { state } = useSheet();
    const grid = "conditions.list.items";
    return (
        <Scope dataId={grid} class="stat-conditions">
            {idsInOrder(state, grid).map(id => (
                <Scope key={id} dataId={id} class={valueAt(state, `${grid}.${id}.enabled`) ? "stat-condition" : "stat-condition disabled"}>
                    <label>
                        <Checkbox field="enabled" class="custom" />
                        <span>{textAt(state, `${grid}.${id}.name`)}</span>
                    </label>
                    <label title="Stack count">X <NumberField field="stacks" class="short" min="0" /></label>
                </Scope>
            ))}
        </Scope>
    );
}

function StatTrackers() {
    const { state } = useSheet();
    const grid = "resourceTrackers.list.items";
    return (
        <div class="stat-trackers">
            <Scope dataId="fatigue" class="stat-tracker">
                <span>Fatigue</span>
                <span><NumberField field="fatigueCur" class="short" /> / {textAt(state, "fatigue.fatigueMax")}</span>
            </Scope>
            <Scope dataId={grid}>
                {idsInOrder(state, grid).map(id => (
                    <Scope key={id} dataId={id} class="stat-tracker">
                        <span>{textAt(state, `${grid}.${id}.name`)}</span>
                        <NumberField field="value" class="short" />
                    </Scope>
                ))}
            </Scope>
        </div>
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
    return (
        <div class="stat-block">
            <StatCharacteristics />
            <Section title="Armour"><StatArmour /></Section>
            <Section title="Movement"><StatMovement /></Section>
            <StatSkills />
            <StatAttacks />
            <Section title="Conditions and trackers">
                <StatConditions />
                <StatTrackers />
            </Section>
            <StatTraits />
        </div>
    );
}
