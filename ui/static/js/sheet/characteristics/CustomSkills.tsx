import { joinPath, usePath, useSheet } from "../components/context";
import { NumberField, Select, TextField } from "../components/fields";
import { peekAt } from "../core/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import type { SheetSignals } from "../schema/sheet";
import { CUSTOM_SKILL_PREFIX } from "./skillNames";
import { AdvanceCheckboxes, Difficulty } from "./skillParts";

/** The paths of the items that go with a deleted custom skill, by the skill's key (`custom:<id>`). */
type Dependents = (state: SheetSignals, skill: string) => string[];

function CustomSkill({ itemId, dependents }: { itemId: string; dependents: Dependents }) {
    const path = joinPath(usePath(), itemId);
    const { state, stats, actions } = useSheet();
    const remove = () => {
        for (const item of dependents(state, CUSTOM_SKILL_PREFIX + itemId)) actions.deleteItem(item);
        actions.deleteItem(path);
    };
    return (
        <Scope dataId={itemId} class="custom-skill">
            <TextField field="name" class="long" />
            <Select field="characteristic" options={stats.characteristics.map(c => c.key)} />
            <AdvanceCheckboxes rowPath={path} />
            <NumberField field="miscBonus" class="short textlike" />
            <Difficulty rowPath={path} label={() => String(peekAt(state, `${path}.name`) ?? "")} />
            <DragHandle />
            <DeleteButton itemPath={path} onDelete={remove} />
        </Scope>
    );
}

/**
 * Custom skills under the skill table. The layout passes `dependents`: what is
 * built on a skill lives in the topics above, as the test options of rolls.
 */
export function CustomSkills({ dependents }: { dependents: Dependents }) {
    return (
        <ItemGrid
            dataId="customSkills.list.items"
            id="custom-skills"
            itemClass="custom-skill"
            renderItem={id => <CustomSkill itemId={id} dependents={dependents} />}
        />
    );
}
