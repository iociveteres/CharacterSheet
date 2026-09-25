// Armour & Defence: the body parts, each with a dropdown of its armour and of
// what gear, shields and entries add to it, and the wounds and armour totals.
import { useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals-core";
import { useDismiss } from "../components/Dropdown";
import { NumberField, ReadonlyField, TextField, valueAt } from "../components/fields";
import { Scope } from "../components/Scope";
import { AP_TYPES, BODY_PARTS, optionLabel, optionValue } from "../schema/constants";
import { collectEntries, gearArmourApForPart, shieldApForPart } from "../state/computed.js";
import { characterState } from "../state/state.js";
import { getItemVersion } from "../state/sync.js";
import { resolveStackExpr } from "../system.js";

type Node = { [key: string]: Node & { value?: unknown } } & { value?: unknown };

const items = (grid: Node | undefined): Node[] => Object.values((grid?.list?.items ?? {}) as { [id: string]: Node });
type BodyPartKey = Parameters<typeof gearArmourApForPart>[1];
const state = characterState as unknown as { [key: string]: Node | undefined };

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
function ArmourContributions({ part }: { part: string }) {
    getItemVersion("gear.list.items").value;
    const rows = items(state.gear)
        .filter(item => item.gearType?.value === "armour" && item.equipped?.value)
        .map(item => ({
            name: String(item.name?.value || "—"),
            ap: gearArmourApForPart(item.armour, part as BodyPartKey, "ap") as number | null,
            superAp: gearArmourApForPart(item.armour, part as BodyPartKey, "superAp") as number | null,
        }))
        .filter(p => p.ap !== null || p.superAp !== null)
        .map(p => ({
            label: <span class="armour-name">{p.name}</span>,
            value: `+${p.ap ?? "-"}${p.superAp !== null ? `/${p.superAp}` : ""}`,
        }));
    return <div class="armour-contributions"><Rows kind="armour-contribution" header="Armour" headerClass="armour-contribution-header" rows={rows} /></div>;
}

/** Shields of melee attacks that cover the part. */
function ShieldContributions({ part }: { part: string }) {
    getItemVersion("meleeAttacks.list.items").value;
    const rows = items(state.meleeAttacks)
        .map(attack => ({ name: String(attack.name?.value || "—"), ap: shieldApForPart(attack.shield, attack.group?.value, part) as number | null }))
        .filter(s => s.ap !== null)
        .map(s => ({ label: <span>{s.name}</span>, value: `+${s.ap}` }));
    return <div class="shield-contributions"><Rows kind="shield-contribution" header="Shields" headerClass="shield-contributions-header" rows={rows} /></div>;
}

const AP_TYPE_LABELS = new Map(AP_TYPES.map(o => [optionValue(o), optionLabel(o)]));
const MANUAL_FIELD_BY_TYPE: { [type: string]: string } = {
    natural: "naturalArmourValue",
    daemonic: "daemonicValue",
    machine: "machineValue",
};

type ApSource = { name: string | null; apType: string; ap: number };

/**
 * Bonus AP of entries, the same under every part. Natural, daemonic and
 * machine AP do not stack: only the highest of the entries and the manual
 * field of a type counts, and the manual field is listed only when it wins.
 * Other AP stacks, so every entry of it is listed.
 */
function MiscContributions() {
    const fromEntries: ApSource[] = (collectEntries("bonus_ap") as { entry: Node; stacks: number; source: Node }[])
        .map(({ entry, stacks, source }) => ({
            name: String(source.name?.value || "—"),
            apType: String(entry.apType?.value || "natural"),
            ap: resolveStackExpr(entry.apValue?.value as string, stacks),
        }))
        .filter(r => r.ap);
    const manual: ApSource[] = Object.entries(MANUAL_FIELD_BY_TYPE)
        .map(([apType, field]) => ({ name: null, apType, ap: Number(state.armour?.[field]?.value) || 0 }))
        .filter(r => r.ap);

    const rows: ApSource[] = [];
    const best = new Map<string, ApSource>();
    for (const r of [...fromEntries, ...manual]) {
        if (r.apType === "other") {
            rows.push(r);
            continue;
        }
        const b = best.get(r.apType);
        if (!b || r.ap > b.ap) best.set(r.apType, r);
    }
    rows.push(...best.values());

    const shown = rows.map(r => {
        const type = AP_TYPE_LABELS.get(r.apType) || r.apType;
        const label = r.name === null
            ? <span>{type}</span>
            : <span>{`${r.name} `}<span class="misc-contribution-type">{`(${type})`}</span></span>;
        return { label, value: `+${r.ap}` };
    });
    return <div class="misc-contributions"><Rows kind="misc-contribution" header="Misc" headerClass="misc-contributions-header" rows={shown} /></div>;
}

function ExtraField({ n }: { n: 1 | 2 }) {
    return (
        <label>
            <TextField field={`extra${n}Name`} placeholder={`Extra ${n}`} class="label-input" />:
            <NumberField field={`extra${n}Value`} />
        </label>
    );
}

function BodyPart({ part, label, hits, openPart }: { part: string; label: string; hits: string; openPart: Signal<string | null> }) {
    const ref = useRef<HTMLDivElement>(null);
    const open = openPart.value === part;
    // Opening another part closes this one; a click outside every part closes it too.
    useDismiss(ref, open, () => { openPart.value = null; },
        e => !e.composedPath().some(n => n instanceof Element && n.classList.contains("body-part")));
    // Worn armour gear replaces the part's own armour and super armour.
    const gearArmour = valueAt(`armour.${part}.gearArmourAP`) !== null;

    return (
        <Scope dataId={part} class="body-part" elRef={ref} style={open ? { zIndex: 100 } : undefined}>
            <span>{label}</span>
            <div class="armour-input-wrapper">
                <ReadonlyField field="sum" type="number" class="armour-sum textlike" title="Sum of armour + extras" />
                <button
                    class={open ? "armour-extra-toggle active" : "armour-extra-toggle"}
                    type="button"
                    onClick={() => { openPart.value = open ? null : part; }}
                >▼</button>
                <div class={open ? "armour-extra-dropdown visible" : "armour-extra-dropdown"}>
                    <ArmourContributions part={part} />
                    <ShieldContributions part={part} />
                    <MiscContributions />

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
                    <ReadonlyField field="toughnessSuper" type="number" class="toughness-super textlike" title="Toughness bonus" />
                    <ReadonlyField field="total" type="number" class="armour-total textlike" title="Total damage absorption" />
                    <ReadonlyField field="superArmourSub" type="number" class="super-armour-sub textlike"
                        title="Super Armor, damage with pen less than super armour value is reduced by half (rounded up, before absorption)" />
                </div>
            </div>
        </Scope>
    );
}

function LabelledNumber({ id, field, label, readonly, title }: { id: string; field: string; label: string; readonly?: boolean; title?: string }) {
    return (
        <>
            <label for={id}>{label}</label>
            {readonly
                ? <ReadonlyField id={id} field={field} type="number" class="short-input textlike" title={title} />
                : <NumberField id={id} field={field} class="short-input" />}
        </>
    );
}

export function Armour() {
    const openPart = useSignal<string | null>(null);
    return (
        <Scope dataId="armour" class="layout-row align-items-start">
            <div class="layout-column">
                <div class="mask-container" />
                {ROWS.map((row, i) => (
                    <div key={i} class="layout-row">
                        {row.map(({ key, label, hits }) => <BodyPart key={key} part={key} label={label} hits={hits} openPart={openPart} />)}
                    </div>
                ))}
            </div>

            <div id="armour-and-defense-right-col" class="layout-column">
                <h3>Wounds</h3>
                <div class="wounds-grid">
                    <div class="wounds-left">
                        <LabelledNumber id="wounds-max" field="woundsMax" label="Wounds" />
                        <LabelledNumber id="ablative-wounds" field="ablativeWounds" label="Ablative" readonly
                            title="Total ablative wounds from conditions, gear and cybernetics" />
                    </div>
                    <div class="wounds-right">
                        <LabelledNumber id="wounds-cur" field="woundsCur" label="Current" />
                    </div>
                    <div class="wounds-remaining">
                        <LabelledNumber id="wounds-remaining" field="woundsRemaining" label="Remaining" readonly />
                    </div>
                </div>

                <h3>Armour</h3>
                <div class="layout-row">
                    <label for="toughness-base-absorption-value">Toughness Base:</label>
                    <ReadonlyField id="toughness-base-absorption-value" field="toughnessBaseAbsorptionValue" type="number"
                        class="short-input" title="Toughness bonus (T.base = Characteristic / 10)" />
                </div>
                <div class="layout-row"><LabelledNumber id="daemonic-value" field="daemonicValue" label="Daemonic:" /></div>
                <div class="layout-row"><LabelledNumber id="natural-armour-value" field="naturalArmourValue" label="Natural Armour:" /></div>
                <div class="layout-row"><LabelledNumber id="machine-value" field="machineValue" label="Machine:" /></div>
                <div class="layout-row"><LabelledNumber id="other-armour-value" field="otherArmourValue" label="Other:" /></div>
            </div>
        </Scope>
    );
}
