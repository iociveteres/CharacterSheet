// Ranged and melee attacks. Each has a roll dropdown under its name label;
// a melee attack has tabs of weapon profiles and, as a shield, shield fields.
import { nanoid } from "nanoid";
import { t } from "../../i18n";
import { useComputed } from "@preact/signals";
import { ToggleField, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, Row, Select, TextArea, TextField, hasText } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/AutocompleteField";
import {
    MELEE_GROUPS, MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_CLASSES, RANGED_ROLL_COLUMNS, SHIELD_ARMS,
    SHIELD_SUBTYPES, type RollColumn,
} from "../schema/constants";
import { ModdedField } from "../rolls/ModdedField";
import { RangeField } from "./Range";
import { ReloadField } from "./Reload";
import { GripRow, MeleeRangeField } from "./Grips";
import { AttackLinkMark, ItemProperties, SpecialField, damageRollLabel, useInGear, useLinkMark } from "./ItemLink";
import { applyMeleeEntry, useInTraits } from "./TraitLink";
import { MELEE_ATTACKS, RANGED_ATTACKS } from "../gear/itemLinkRules";
import { MACE_PROFILE, gripText } from "./gripRules";
import { gripProperties, heldGrip, meleeAttackBonus, meleeHitLines, profileName } from "./melee";
import { hitLines } from "./weaponBonus";
import { meleeRollTags, stanceOf, stanceTitle } from "./stanceRules";
import { STRENGTH_BONUS, WEAPON_DAMAGE, WEAPON_FIELD, profileRollLabel } from "./weaponDamage";
import { code, label, NAME, SPACE, type Label } from "../rollLabel";
import { modsAt, modsGrid } from "../rolls/damage";
import { idsInOrder } from "../core/gridOrder";
import { peekAt, textAt, valueAt } from "../core/sync";
import { newItemAt } from "../core/fromJson";
import { schemaOf } from "../core/state";
import { rollBonusSuccesses } from "../rolls/rollBase";
import { firstTestOption } from "../rolls/testOptionRules";
import type { SheetSignals } from "../schema/sheet";
import type { RollDefaults } from "../payload";
import {
    DamageLabel, ExtraModifier, RadioColumn, RollResult, RollToggleLabel, TestSelect,
    attackTotal, extraNames, rollLabel, selectedCodes, useRollTest,
} from "../rolls/rollParts";

export interface AttackRollProps {
    path: string;
    open: boolean;
    close: () => void;
    columns: readonly RollColumn[];
    block: "rangedAttacks" | "meleeAttacks";
    /** Classes next to roll-dropdown. */
    class?: string;
}

/** The roll dropdown of an attack: its columns, the extra modifiers and the result on one of its block's test options. */
export function AttackRoll({ path, open, close, columns, block, class: cls }: AttackRollProps) {
    const { state, rolls, ui } = useSheet();
    const rollPath = `${path}.roll`;
    const test = useRollTest(block, rollPath);
    const tab = ui.selectedTabSignal(`${path}.tabs.items`);
    const total = useComputed(() => (block === "rangedAttacks"
        ? attackTotal(state, rollPath, test.value ?? "", columns, "ranged") + hitLines(state, path).reduce((sum, line) => sum + line.add, 0)
        : attackTotal(state, rollPath, test.value ?? "", columns, "melee") + meleeAttackBonus(state, path, tab.value)));
    const roll = () => {
        void rolls.versus(total.peek(), rollBonusSuccesses(state, test.peek()), attackRollLabel(state, path, columns, block, tab.peek()));
        close();
    };
    const classes = cls ? `roll-dropdown ${cls}` : "roll-dropdown";
    return (
        <Scope dataId="roll" class={open ? `${classes} visible` : classes}>
            {columns.map(column => <RadioColumn key={column.key} column={column} />)}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={test.value === null}>
                {block === "meleeAttacks" && <NoAttacks />}
                <TestSelect block={block} />
            </RollResult>
        </Scope>
    );
}

/**
 * The label of an attack roll of the attack at `path` of `block`, with the
 * profile tab `tab` open: its name, a melee attack's grip and stance, the
 * options selected in `columns`, what adds to the roll and the extra modifiers.
 */
export function attackRollLabel(state: SheetSignals, path: string, columns: readonly RollColumn[], block: AttackRollProps["block"], tab: string | null): Label {
    const melee = block === "meleeAttacks";
    const hit = melee ? meleeHitLines(state, path, tab) : hitLines(state, path);
    return rollLabel(
        String(peekAt(state, `${path}.name`) ?? "") || code(SPACE.name, NAME.unknown),
        [...selectedCodes(state, `${path}.roll`, columns), ...hit.map(line => line.part), ...extraNames(state, `${path}.roll`)],
        melee ? meleeRollTags(state, path) : [],
    );
}

/** In the Defensive stance the rules allow no attacks: a dimmed note, the roll still works. */
function NoAttacks() {
    const { state } = useSheet();
    if (stanceOf(state).key !== "defensive") return null;
    return <span class="dimmed no-attacks" title={stanceTitle(stanceOf(state), null)}>{t("sheet.weapons.noAttacks")}</span>;
}

// ─── Ranged ──────────────────────────────────────────────────────────────────

export const newRangedAttack = (state: SheetSignals, rolls: RollDefaults) =>
    ({ ...newItemAt(schemaOf(state), RANGED_ATTACKS), roll: { ...rolls.rangedAttack, testOption: firstTestOption(state, "rangedAttacks") } });

function RangedAttack({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { state, rollDefaults, stats } = useSheet();
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(state, `${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const base = () => newRangedAttack(state, rollDefaults);
    const inGear = useInGear(path, RANGED_ATTACKS, "ranged", base);
    const link = useLinkMark(path);

    return (
        <Scope dataId={itemId} class={collapsed ? "ranged-attack item-with-description collapsed" : "ranged-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <ToggleField onToggle={toggle}>
                        <AutocompleteField field="name" class="long-input" itemPath={path} collection="ranged" base={base} local={[inGear]}
                            title={link?.title} />
                        <AttackLinkMark attackPath={path} mark={link} />
                    </ToggleField>
                </div>
                <Row cls="class" label={`${t("sheet.termsArms.weaponField.class")}:`}><Select field="class" options={RANGED_CLASSES} /></Row>
                <DragHandle />
                <DeleteButton itemPath={path} />
                {hasRoll && dropdown.open && <AttackRoll path={path} open close={dropdown.close} columns={RANGED_ROLL_COLUMNS} block="rangedAttacks" />}
            </div>
            <div class="layout-row">
                <Row cls="range" label={`${t("sheet.termsArms.weaponField.rng")}:`}><RangeField /></Row>
                <Row cls="damage" label={<DamageLabel owner={WEAPON_DAMAGE} itemPath={path} label={() => damageRollLabel(state, path, label(String(peekAt(state, `${path}.name`) ?? "") || code(SPACE.name, NAME.rangedAttack)))} />}>
                    <ModdedField stat="damage" owner={WEAPON_FIELD} />
                </Row>
                <Row cls="pen" label={`${t("sheet.termsArms.weaponField.pen.short")}:`}><ModdedField stat="pen" owner={WEAPON_FIELD} /></Row>
                <Row cls="damage-type" label={`${t("sheet.termsArms.weaponField.damageType.short")}:`}><Select field="damageType" options={stats.damageTypes} /></Row>
            </div>
            <div class="layout-row">
                <Row cls="rof" label={`${t("sheet.termsArms.weaponField.rof.short")}:`}>
                    <TextField field="rofSingle" />/
                    <TextField field="rofShort" class="shorter-input" />/
                    <TextField field="rofLong" class="shorter-input" />
                </Row>
                <Row cls="clip" label={`${t("sheet.termsArms.weaponField.clip.short")}:`}>
                    <TextField field="clipCur" />/
                    <TextField field="clipMax" />
                </Row>
                <Row cls="reload" label={`${t("sheet.termsArms.weaponField.reload")}:`}><ReloadField /></Row>
            </div>
            <div class="layout-row">
                <Row cls="special" label={`${t("sheet.termsArms.weaponField.special")}:`}>
                    <SpecialField weaponPath={path} />
                    <ItemProperties weaponPath={path} />
                </Row>
            </div>
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function RangedAttacks() {
    const { state, rollDefaults } = useSheet();
    return (
        <ItemGrid
            dataId="rangedAttacks.list.items"
            id="ranged-attack"
            itemClass="ranged-attack"
            newItem={() => newRangedAttack(state, rollDefaults)}
            renderItem={id => <RangedAttack itemId={id} />}
        />
    );
}

// ─── Melee ───────────────────────────────────────────────────────────────────

/** A new melee attack: one Mace profile tab with the Strength bonus and the default roll. */
export function newMeleeAttack(state: SheetSignals, rolls: RollDefaults) {
    const tabId = `tab-${nanoid()}`;
    return {
        ...newMeleeAttackBase(state, rolls),
        tabs: {
            items: { [tabId]: { profile: "mace", damageMods: modsGrid([STRENGTH_BONUS], "damage") } },
            layouts: { [tabId]: { colIndex: 0, rowIndex: 0 } },
        },
    };
}

/** A new profile tab of the melee attack at `attackPath`: the modifiers of its first tab, the Strength bonus without one. */
function newMeleeProfile(state: SheetSignals, attackPath: string) {
    const tabsPath = `${attackPath}.tabs.items`;
    const [first] = idsInOrder(state, tabsPath);
    if (!first) return { damageMods: modsGrid([STRENGTH_BONUS], "damage") };
    const from = `${tabsPath}.${first}`;
    return { damageMods: modsGrid(modsAt(state, from, "damage"), "damage"), penMods: modsGrid(modsAt(state, from, "pen"), "pen") };
}

/** What an autocompleted melee attack starts from; the collection entry brings its tabs. */
export const newMeleeAttackBase = (state: SheetSignals, rolls: RollDefaults) =>
    ({ ...newItemAt(schemaOf(state), MELEE_ATTACKS), roll: { ...rolls.meleeAttack, testOption: firstTestOption(state, "meleeAttacks") } });

/** What the zones of a shield in brackets do in the stance of the sheet; none without such zones. */
function ZonesNote({ attackPath }: { attackPath: string }) {
    const { state } = useSheet();
    const zones = textAt(state, `${attackPath}.shield.defenseSectors`).match(/\([^)]*\)/g);
    if (!zones) return null;
    const on = stanceOf(state).key === "defensive";
    return (
        <span class={on ? "zones-note on" : "zones-note"} data-id="zonesNote"
            title={t("sheet.weapons.zonesNote.title")}>
            {on ? t("sheet.weapons.zonesNote.covered", { zones: zones.join("") }) : t("sheet.weapons.zonesNote.defensiveOnly", { zones: zones.join("") })}
        </span>
    );
}

function ShieldFields({ attackPath }: { attackPath: string }) {
    return (
        <Scope as="fieldset" dataId="shield" class="shield-fields">
            <legend>{t("sheet.termsArms.meleeProfile.shield")}</legend>
            <div class="layout-row">
                <label>{`${t("sheet.termsArms.shieldField.subtype.short")}:`}
                    <Select field="subtype" options={SHIELD_SUBTYPES} />
                </label>
                <label>AP:
                    <NumberField field="ap" />
                </label>
                <label>{`${t("sheet.termsArms.shieldField.zones")}:`}
                    <TextField field="defenseSectors" />
                </label>
            </div>
            <div class="layout-row centered-content">
                <label>{`${t("sheet.termsArms.shieldField.arm")}:`}
                    <Select field="arm" options={SHIELD_ARMS} />
                </label>
                <label>{`${t("sheet.gear.equipped")}:`}
                    <Checkbox field="equipped" class="custom" />
                </label>
                <ZonesNote attackPath={attackPath} />
            </div>
        </Scope>
    );
}

/** The profile select of a tab: the Mace's in Mordhau; dimmed when the grip does not allow it, as Fist all but three. */
function ProfileLabel({ attackPath, tabId }: { attackPath: string; tabId: string }) {
    const { state } = useSheet();
    const { held, effects } = useComputed(() => heldGrip(state, attackPath)).value;
    if (effects.mace) {
        return <select disabled class="mace-profile" title={MACE_TITLE}><option>{t("sheet.termsArms.meleeProfile.mace")}</option></select>;
    }
    const profile = textAt(state, `${attackPath}.tabs.items.${tabId}.profile`);
    const allowed = !effects.profiles || effects.profiles.includes(profile);
    return (
        <Select field="profile" options={MELEE_PROFILES} class={allowed ? undefined : "dimmed"}
            title={allowed ? undefined : t("sheet.weapons.profilesOnly", { grip: held ? gripText(held) : "", profiles: effects.profiles!.map(profileName).join(", ") })} />
    );
}

const MACE_TITLE = t("sheet.weapons.maceTitle");

function ProfilePanel({ attackPath, tabId }: { attackPath: string; tabId: string }) {
    const { state, stats } = useSheet();
    const tabPath = `${attackPath}.tabs.items.${tabId}`;
    const mace = useComputed(() => heldGrip(state, attackPath).effects.mace).value;
    const added = useComputed(() => gripProperties(state, tabPath)).value;
    const held = useComputed(() => {
        const grip = heldGrip(state, attackPath).held;
        return grip ? gripText(grip) : "";
    }).value;
    const damageLabel = () => damageRollLabel(state, tabPath, profileRollLabel(
        String(peekAt(state, `${attackPath}.name`) ?? "") || code(SPACE.name, NAME.meleeAttack),
        mace ? MACE_PROFILE.profile : String(peekAt(state, `${tabPath}.profile`) ?? ""),
    ));
    return (
        <div class="profile-tab">
            <div class="layout-row">
                <Row cls="range" label={`${t("sheet.termsArms.weaponField.rng")}:`}><MeleeRangeField /></Row>
                <Row cls="damage" label={<DamageLabel owner={WEAPON_DAMAGE} itemPath={tabPath} label={damageLabel} />}>
                    <ModdedField stat="damage" owner={WEAPON_FIELD} />
                </Row>
                <Row cls="pen" label={`${t("sheet.termsArms.weaponField.pen.short")}:`}><ModdedField stat="pen" owner={WEAPON_FIELD} /></Row>
                <Row cls="damage-type" label={`${t("sheet.termsArms.weaponField.damageType.short")}:`}>
                    {mace
                        ? <select disabled title={MACE_TITLE}><option>{MACE_PROFILE.damageType}</option></select>
                        : <Select field="damageType" options={stats.damageTypes} />}
                </Row>
            </div>
            <div class="layout-row">
                <Row cls="special" label={`${t("sheet.termsArms.weaponField.special")}:`}>
                    {mace
                        ? <input type="text" class="uneditable" readOnly tabIndex={-1} value={MACE_PROFILE.special} title={MACE_TITLE} />
                        : <SpecialField weaponPath={tabPath} />}
                    {added.length > 0 && <span class="added-property" data-id="addedProperties" title={t("sheet.weapons.addedByGrip", { grip: held })}>{`+ ${added.join(", ")}`}</span>}
                    <ItemProperties weaponPath={tabPath} />
                </Row>
            </div>
        </div>
    );
}

function MeleeAttack({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const env = useSheet();
    const { state, rollDefaults } = env;
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(state, `${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const isShield = valueAt(state, `${path}.group`) === "primary (shield)";
    const base = () => newMeleeAttackBase(state, rollDefaults);
    const inGear = useInGear(path, MELEE_ATTACKS, "melee", base);
    const inTraits = useInTraits(path, base);
    const link = useLinkMark(path);

    return (
        <Scope dataId={itemId} class={collapsed ? "melee-attack item-with-description collapsed" : "melee-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <ToggleField onToggle={toggle}>
                        <AutocompleteField field="name" class="long-input" itemPath={path} collection="melee" base={base}
                            local={[inGear, inTraits]} apply={r => applyMeleeEntry(env, path, base, r)} title={link?.title} />
                        <AttackLinkMark attackPath={path} mark={link} />
                    </ToggleField>
                </div>
                <div class="layout-row group">
                    <label>{`${t("sheet.termsArms.weaponField.group")}:`}</label>
                    <Select field="group" options={MELEE_GROUPS} />
                    <DragHandle />
                    <DeleteButton itemPath={path} />
                </div>
                {hasRoll && dropdown.open && <AttackRoll path={path} open close={dropdown.close} columns={MELEE_ROLL_COLUMNS} block="meleeAttacks" class="melee" />}
            </div>
            <GripRow attackPath={path} />
            {isShield && <ShieldFields attackPath={path} />}
            <Tabs
                dataId="tabs.items"
                group={itemId}
                renderLabel={tabId => <ProfileLabel attackPath={path} tabId={tabId} />}
                renderPanel={tabId => <ProfilePanel attackPath={path} tabId={tabId} />}
                newItem={() => newMeleeProfile(state, path)}
            />
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function MeleeAttacks() {
    const { state, rollDefaults } = useSheet();
    return (
        <ItemGrid
            dataId="meleeAttacks.list.items"
            id="melee-attack"
            itemClass="melee-attack"
            newItem={() => newMeleeAttack(state, rollDefaults)}
            renderItem={id => <MeleeAttack itemId={id} />}
        />
    );
}
