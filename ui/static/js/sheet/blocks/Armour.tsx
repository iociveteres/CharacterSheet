// Armour & Defence: the body parts, each with a dropdown of its armour and of
// what gear, shields and entries add to it, and the wounds and armour totals.
// Only this block shows armour, so it computes it, and a total and the
// breakdown under it come from the same computeds.
import { useMemo, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useSignal } from "@preact/signals";
import { computed, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { useDismiss } from "../components/Dropdown";
import { NumberField, ReadonlyField, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { AP_TYPES, BODY_PARTS, optionLabel, optionValue } from "../schema/constants";
import { collectEntries, sumEntryField } from "../state/computed";
import { characterState } from "../state/state";
import { calculateCharacteristicBase, parseDefenseSectors, resolveStackExpr, signed } from "../system";

type Node = { [key: string]: Node & { value?: unknown } } & { value?: unknown };

const state = characterState as unknown as { [key: string]: Node | undefined };
const items = (grid: Node | undefined): Node[] => Object.values((grid?.list?.items ?? {}) as { [id: string]: Node });
const num = (node: Node | undefined) => Number(node?.value) || 0;
const nameOf = (item: Node) => String(item.name?.value || "—");

// ─── Rules ───────────────────────────────────────────────────────────────────

// The field of a gear item's armour that covers each body part.
const GEAR_FIELD: { readonly [part: string]: string } = {
    head: "head", body: "torso", leftArm: "arms", rightArm: "arms", leftLeg: "legs", rightLeg: "legs",
};

/** The AP of a gear item's armour on the part; null when it does not cover it ("-" or empty). */
function gearAp(armour: Node | undefined, part: string, kind: "ap" | "superAp"): number | null {
    const raw = armour?.[kind]?.[GEAR_FIELD[part]]?.value;
    if (raw === undefined || raw === null || raw === "-" || raw === "") return null;
    const n = parseInt(String(raw), 10);
    return Number.isNaN(n) ? null : n;
}

/** The AP the shield of a melee attack gives the part; null unless it is an equipped shield covering it. */
function shieldAp(attack: Node, part: string): number | null {
    const shield = attack.shield;
    if (attack.group?.value !== "primary (shield)" || !shield?.equipped?.value) return null;
    const { alwaysParts, defensiveParts } = parseDefenseSectors(shield.defenseSectors?.value as string, (shield.arm?.value as string) ?? "left");
    if (alwaysParts.has(part) || (shield.defensive?.value && defensiveParts.has(part))) return num(shield.ap);
    return null;
}

type ApSource = { name: string | null; apType: string; ap: number };

// AP of these types is the same under every part. Natural, daemonic and
// machine AP do not stack: the highest of the manual field and the entries of
// the type counts. Other AP stacks.
const AP_CATEGORIES = [
    { apType: "daemonic", field: "daemonicValue", stacks: false },
    { apType: "natural", field: "naturalArmourValue", stacks: false },
    { apType: "machine", field: "machineValue", stacks: false },
    { apType: "other", field: "otherArmourValue", stacks: true },
] as const;

/** The AP of a category and what makes it up: every non-zero source that stacks, else the one that counts. */
function categoryAp({ apType, field, stacks }: (typeof AP_CATEGORIES)[number]): { ap: number; sources: ApSource[] } {
    const manual: ApSource = { name: null, apType, ap: num(state.armour?.[field]) };
    const entries: ApSource[] = (collectEntries("bonus_ap") as unknown as { entry: Node; stacks: number; source: Node }[])
        .filter(({ entry }) => (entry.apType?.value || "natural") === apType)
        .map(({ entry, stacks: n, source }) => ({ name: nameOf(source), apType, ap: resolveStackExpr(entry.apValue?.value as string, n) }));
    if (stacks) {
        return {
            ap: entries.reduce((sum, s) => sum + s.ap, manual.ap),
            sources: [...entries, manual].filter(s => s.ap),
        };
    }
    const best = entries.reduce((b, s) => (s.ap > b.ap ? s : b), manual);
    return { ap: best.ap, sources: best.ap ? [best] : [] };
}

type GearPiece = { name: string; ap: number | null; superAp: number | null };
type Shield = { name: string; ap: number };

function bodyPartComputeds(part: string, toughnessBase: ReadonlySignal<number>, categoriesAp: ReadonlySignal<number>, daemonic: ReadonlySignal<number>) {
    const own = () => state.armour?.[part];
    const pieces = computed((): GearPiece[] => {
        return items(state.gear)
            .filter(item => item.gearType?.value === "armour" && item.equipped?.value)
            .map(item => ({ name: nameOf(item), ap: gearAp(item.armour, part, "ap"), superAp: gearAp(item.armour, part, "superAp") }))
            .filter(p => p.ap !== null || p.superAp !== null);
    });
    const shields = computed((): Shield[] => {
        return items(state.meleeAttacks)
            .map(attack => ({ name: nameOf(attack), ap: shieldAp(attack, part) }))
            .filter((s): s is Shield => s.ap !== null);
    });
    // Worn armour gear replaces the part's own armour and super armour; the best piece counts.
    const best = (kind: "ap" | "superAp") => {
        const values = pieces.value.map(p => p[kind]).filter((n): n is number => n !== null);
        return values.length ? Math.max(...values) : null;
    };
    const gearArmour = computed(() => best("ap"));
    const sum = computed(() => (gearArmour.value ?? num(own()?.armourValue)) + num(own()?.extra1Value) + num(own()?.extra2Value));

    return {
        pieces,
        shields,
        gearArmour,
        sum,
        total: computed(() => sum.value + shields.value.reduce((t, s) => t + s.ap, 0) + toughnessBase.value + categoriesAp.value),
        toughnessSuper: computed(() => toughnessBase.value + daemonic.value),
        superArmourSub: computed(() => best("superAp") ?? num(own()?.superArmour)),
    };
}

type BodyPartComputeds = ReturnType<typeof bodyPartComputeds>;

function armourComputeds() {
    const toughnessBase = computed(() => {
        const T = state.characteristics?.T;
        return calculateCharacteristicBase(num(T?.calculatedValue), num(T?.calculatedUnnatural));
    });
    const categories = Object.fromEntries(AP_CATEGORIES.map(c => [c.apType, computed(() => categoryAp(c))]));
    const categoriesAp = computed(() => AP_CATEGORIES.reduce((sum, c) => sum + categories[c.apType].value.ap, 0));
    const daemonic = computed(() => categories.daemonic.value.ap);
    const ablativeWounds = computed(() => sumEntryField("ablative_wounds", "ablativeWounds") as number);

    return {
        toughnessBase,
        misc: computed(() => AP_CATEGORIES.flatMap(c => categories[c.apType].value.sources)),
        ablativeWounds,
        woundsRemaining: computed(() => num(state.armour?.woundsMax) + ablativeWounds.value - num(state.armour?.woundsCur)),
        parts: Object.fromEntries(BODY_PARTS.map(({ key }) => [key, bodyPartComputeds(key, toughnessBase, categoriesAp, daemonic)])),
    };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

// The body parts in the rows of the figure.
const ROWS = [["head"], ["leftArm", "body", "rightArm"], ["leftLeg", "rightLeg"]]
    .map(row => row.map(key => BODY_PARTS.find(p => p.key === key)!));

interface Row {
    label: ComponentChildren;
    value: string;
}

function Rows({ kind, header, headerClass, rows }: { kind: string; header: string; headerClass: string; rows: Row[] }) {
    if (!rows.length) return null;
    return (
        <>
            <div class={headerClass}>{header}</div>
            {rows.map((r, i) => (
                <div key={i} class={`layout-row ${kind}-row`}>
                    {r.label}
                    <span>{r.value}</span>
                </div>
            ))}
        </>
    );
}

/** Pieces of equipped armour gear that cover the part. */
function ArmourContributions({ pieces }: { pieces: ReadonlySignal<GearPiece[]> }) {
    const rows = pieces.value.map(p => ({
        label: <span class="armour-name">{p.name}</span>,
        value: `${p.ap === null ? "+-" : signed(p.ap)}${p.superAp !== null ? `/${p.superAp}` : ""}`,
    }));
    return <div class="armour-contributions"><Rows kind="armour-contribution" header="Armour" headerClass="armour-contribution-header" rows={rows} /></div>;
}

/** Shields of melee attacks that cover the part. */
function ShieldContributions({ shields }: { shields: ReadonlySignal<Shield[]> }) {
    const rows = shields.value.map(s => ({ label: <span>{s.name}</span>, value: signed(s.ap) }));
    return <div class="shield-contributions"><Rows kind="shield-contribution" header="Shields" headerClass="shield-contributions-header" rows={rows} /></div>;
}

const AP_TYPE_LABELS = new Map(AP_TYPES.map(o => [optionValue(o), optionLabel(o)]));

/** The AP of the categories, the same under every part; a manual field is named by its type. */
function MiscContributions({ misc }: { misc: ReadonlySignal<ApSource[]> }) {
    const rows = misc.value.map(r => {
        const type = AP_TYPE_LABELS.get(r.apType) || r.apType;
        const label = r.name === null
            ? <span>{type}</span>
            : <span>{`${r.name} `}<span class="misc-contribution-type">{`(${type})`}</span></span>;
        return { label, value: signed(r.ap) };
    });
    return <div class="misc-contributions"><Rows kind="misc-contribution" header="Misc" headerClass="misc-contributions-header" rows={rows} /></div>;
}

function ExtraField({ n }: { n: 1 | 2 }) {
    return (
        <label>
            <TextField field={`extra${n}Name`} placeholder={`Extra ${n}`} class="label-input" />:
            <NumberField field={`extra${n}Value`} />
        </label>
    );
}

interface BodyPartProps {
    part: string;
    label: string;
    hits: string;
    openPart: Signal<string | null>;
    armour: BodyPartComputeds;
    misc: ReadonlySignal<ApSource[]>;
}

function BodyPart({ part, label, hits, openPart, armour, misc }: BodyPartProps) {
    const ref = useRef<HTMLDivElement>(null);
    const open = openPart.value === part;
    // Opening another part closes this one; a click outside every part closes it too.
    useDismiss(ref, open, () => { openPart.value = null; },
        e => !e.composedPath().some(n => n instanceof Element && n.classList.contains("body-part")));
    // Worn armour gear replaces the part's own armour and super armour.
    const gearArmour = armour.gearArmour.value !== null;

    return (
        <Scope dataId={part} class="body-part" elRef={ref} style={open ? { zIndex: 100 } : undefined}>
            <span>{label}</span>
            <div class="armour-input-wrapper">
                <ReadonlyField field="sum" value={armour.sum} type="number" class="armour-sum textlike" title="Sum of armour + extras" />
                <button
                    class={open ? "armour-extra-toggle active" : "armour-extra-toggle"}
                    type="button"
                    onClick={() => { openPart.value = open ? null : part; }}
                >▼</button>
                <div class={open ? "armour-extra-dropdown visible" : "armour-extra-dropdown"}>
                    <ArmourContributions pieces={armour.pieces} />
                    <ShieldContributions shields={armour.shields} />
                    <MiscContributions misc={misc} />

                    <label class={gearArmour ? "field-hidden" : undefined}>Armour: <NumberField field="armourValue" /></label>
                    <ExtraField n={1} />
                    <ExtraField n={2} />
                    <label class={gearArmour ? "field-hidden" : undefined}>Super Armour: <NumberField field="superArmour" /></label>
                </div>
            </div>
            <span class="hit-location">({hits})</span>
            <div class="armour-total-display">
                <span class="total-label">Total:</span>
                <div class="total-notation">
                    <ReadonlyField field="toughnessSuper" value={armour.toughnessSuper} type="number" class="toughness-super textlike" title="Toughness bonus" />
                    <ReadonlyField field="total" value={armour.total} type="number" class="armour-total textlike" title="Total damage absorption" />
                    <ReadonlyField field="superArmourSub" value={armour.superArmourSub} type="number" class="super-armour-sub textlike"
                        title="Super Armor, damage with pen less than super armour value is reduced by half (rounded up, before absorption)" />
                </div>
            </div>
        </Scope>
    );
}

interface LabelledNumberProps {
    id: string;
    field: string;
    label: string;
    /** A value the block computes; the field is an input without it. */
    value?: ReadonlySignal<number>;
    title?: string;
}

function LabelledNumber({ id, field, label, value, title }: LabelledNumberProps) {
    return (
        <>
            <label for={id}>{label}</label>
            {value
                ? <ReadonlyField id={id} field={field} value={value} type="number" class="short-input textlike" title={title} />
                : <NumberField id={id} field={field} class="short-input" />}
        </>
    );
}

export function Armour() {
    const openPart = useSignal<string | null>(null);
    const armour = useMemo(armourComputeds, []);
    return (
        <Scope dataId="armour" class="layout-row align-items-start">
            <div class="layout-column">
                <div class="mask-container" />
                {ROWS.map((row, i) => (
                    <div key={i} class="layout-row">
                        {row.map(({ key, label, hits }) => (
                            <BodyPart key={key} part={key} label={label} hits={hits} openPart={openPart}
                                armour={armour.parts[key]} misc={armour.misc} />
                        ))}
                    </div>
                ))}
            </div>

            <div id="armour-and-defense-right-col" class="layout-column">
                <h3>Wounds</h3>
                <div class="wounds-grid">
                    <div class="wounds-left">
                        <LabelledNumber id="wounds-max" field="woundsMax" label="Wounds" />
                        <LabelledNumber id="ablative-wounds" field="ablativeWounds" label="Ablative" value={armour.ablativeWounds}
                            title="Total ablative wounds from conditions, gear and cybernetics" />
                    </div>
                    <div class="wounds-right">
                        <LabelledNumber id="wounds-cur" field="woundsCur" label="Current" />
                    </div>
                    <div class="wounds-remaining">
                        <LabelledNumber id="wounds-remaining" field="woundsRemaining" label="Remaining" value={armour.woundsRemaining} />
                    </div>
                </div>

                <h3>Armour</h3>
                <div class="layout-row">
                    <label for="toughness-base-absorption-value">Toughness Base:</label>
                    <ReadonlyField id="toughness-base-absorption-value" field="toughnessBaseAbsorptionValue" value={armour.toughnessBase}
                        type="number" class="short-input" title="Toughness bonus (T.base = Characteristic / 10)" />
                </div>
                <div class="layout-row"><LabelledNumber id="daemonic-value" field="daemonicValue" label="Daemonic:" /></div>
                <div class="layout-row"><LabelledNumber id="natural-armour-value" field="naturalArmourValue" label="Natural Armour:" /></div>
                <div class="layout-row"><LabelledNumber id="machine-value" field="machineValue" label="Machine:" /></div>
                <div class="layout-row"><LabelledNumber id="other-armour-value" field="otherArmourValue" label="Other:" /></div>
            </div>
        </Scope>
    );
}
