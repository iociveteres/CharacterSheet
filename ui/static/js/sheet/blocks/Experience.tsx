// Experience: cost settings, totals and the log of advancements. The cost of
// an advancement is computed (state/itemComputeds.js).
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, type AutocompleteResult } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextField, valueAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/useAutocomplete";
import { ALIGNMENT_PATHS, EXPERIENCE_LEVELS_BY_TYPE, EXPERIENCE_TYPES } from "../schema/constants";

function AlignmentSelect() {
    return (
        <Select field="alignment">
            <option value="Undivided">Undivided</option>
            {ALIGNMENT_PATHS.map(([god, paths]) => (
                <optgroup key={god} label={god}>
                    {paths.map(p => <option key={p} value={`${god} (${p})`}>{`${god} (${p})`}</option>)}
                </optgroup>
            ))}
        </Select>
    );
}

function advancementOption(r: AutocompleteResult): string {
    const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
    const type = r.type ? `<span class="ac-type">${r.type}</span>` : "";
    const cost = r.experienceCost ? `<span class="ac-cost">${r.experienceCost} xp</span>` : "";

    let meta = "";
    if (r.discipline) {
        meta += `<span class="ac-meta">${r.discipline}`;
        if (r.subdiscipline) meta += ` / ${r.subdiscipline}`;
        meta += "</span>";
    }

    let reqs = "";
    const req = r.requirements as unknown;
    if (typeof req === "string" && req.trim()) {
        reqs = `<span class="ac-reqs">Req: ${req.trim()}</span>`;
    } else if (Array.isArray(req) && req.length) {
        reqs = `<span class="ac-reqs">Req: ${req.join(", ")}</span>`;
    } else if (req && typeof req === "object") {
        const r2 = req as { race?: string; patron?: string; stats?: unknown; xp_notes?: string; xp?: string };
        const parts: string[] = [];
        if (r2.race) parts.push(r2.race);
        if (r2.patron) parts.push(r2.patron);
        if (Array.isArray(r2.stats)) parts.push(...r2.stats);
        if (r2.xp_notes) parts.push(r2.xp_notes);
        else if (r2.xp) parts.push(`${r2.xp} xp`);
        if (parts.length) reqs = `<span class="ac-reqs">Req: ${parts.join(", ")}</span>`;
    }

    return `<div class="ac-header"><span class="ac-name">${name}</span>${type}${cost}</div>`
        + `<div class="ac-details">${meta}${reqs}</div>`;
}

function ExperienceItem({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    // Advancements start collapsed and stay so when a remote batch changes them.
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => true,
        startsCollapsed: () => true,
        autoExpand: false,
    });
    const type = String(valueAt(`${path}.type`) ?? "");
    const levels = EXPERIENCE_LEVELS_BY_TYPE[type];
    const computedCost = levels !== undefined;

    return (
        <Scope dataId={itemId} class={collapsed ? "experience-item item-with-description collapsed" : "experience-item item-with-description"} elRef={elRef}>
            <div class="split-header">
                <AutocompleteField field="name" class="long" itemPath={path} collection="advancements" renderOption={advancementOption} />
                <ToggleButton onToggle={toggle} />
                <ReadonlyField field="computedCost" type="number" class="short textlike" />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <div class="layout-row">
                    <label>Type:</label>
                    <Select field="type" options={EXPERIENCE_TYPES} />
                    {!computedCost && (
                        <label class="exp-field-cost">Cost:
                            <NumberField field="experienceCost" class="short textlike" />
                        </label>
                    )}
                </div>
                {computedCost && (
                    <>
                        <div class="layout-row exp-field-calc">
                            <label>Level:
                                <Select key={type} field="level" class={`short level-${type}`} data-type="number" options={levels} />
                            </label>
                            <label>Aptitudes:
                                <TextField field="aptitudes" placeholder="S,Off" />
                            </label>
                        </div>
                        <div class="layout-row exp-field-calc">
                            <label>Allied:
                                <TextField field="alliedTo" placeholder="e.g. Khorne" />
                            </label>
                            {type === "characteristic" && (
                                <div class="exp-field-hostile">
                                    <label>Hostile:
                                        <TextField field="hostileTo" placeholder="comma-separated gods" />
                                    </label>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </Scope>
    );
}

export function Experience() {
    return (
        <Scope dataId="experience" class="layout-column quarter-grid-column">
            <h2 class="align-self-center">Experience</h2>
            <div class="layout-column centered-bar">
                <div id="experience-cost-mods" class="layout-row">
                    <label>
                        Use Devotion
                        <Checkbox field="useDevotion" class="custom" />
                    </label>
                    <label>Alignment:
                        <AlignmentSelect />
                    </label>
                </div>

                <div id="experience-cost-options" class="layout-row gap-5">
                    <label>
                        Use Aptitudes
                        <Checkbox field="useAptitudes" class="custom" />
                    </label>
                    <label>Aptitudes:
                        <TextField field="aptitudes" class="long" placeholder="e.g. WS, T, Fin, etc" />
                    </label>
                </div>

                <div id="experience-bar" class="layout-row">
                    <label>Total XP:</label>
                    <NumberField field="experienceTotal" class="short" />
                    <label>Spent XP:</label>
                    <ReadonlyField field="experienceSpent" type="number" class="short" />
                    <label>Remaining XP:</label>
                    <ReadonlyField field="experienceRemaining" type="number" class="short" />
                </div>
            </div>

            <ItemGrid
                dataId="experienceLog.items"
                id="experience-log"
                itemClass="experience-item"
                renderItem={id => <ExperienceItem itemId={id} />}
            />
        </Scope>
    );
}
