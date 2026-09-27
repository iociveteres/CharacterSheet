// Armour & Defence: the body parts, each with a dropdown of its armour and of
// what gear, shields and entries add to it, and the wounds and armour totals.
// The armour itself is computed in state/armour.ts.
import { useMemo, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useSignal } from "@preact/signals";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import { useDismiss } from "../components/Dropdown";
import { NumberField, ReadonlyField, TextField } from "../components/fields";
import { Scope } from "../components/Scope";
import { AP_TYPES, BODY_PARTS, optionLabel, optionValue, type BodyPartKey } from "../schema/constants";
import { armourComputeds, type ApSource, type BodyPartComputeds, type GearPiece, type Shield } from "../state/armour";
import { signed } from "../system";

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
    part: BodyPartKey;
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
        <Scope dataId="armour" class="layout-row">
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
