import { joinPath, usePath, useSheet } from "../components/context";
import { NumberField, Select, TextField } from "../components/fields";
import { peekAt } from "../core/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AdvanceCheckboxes, Difficulty } from "./skillParts";

function CustomSkill({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { state, stats } = useSheet();
    return (
        <Scope dataId={itemId} class="custom-skill">
            <TextField field="name" class="long" />
            <Select field="characteristic" options={stats.characteristics.map(c => c.key)} />
            <AdvanceCheckboxes rowPath={path} />
            <NumberField field="miscBonus" class="short textlike" />
            <Difficulty rowPath={path} label={() => String(peekAt(state, `${path}.name`) ?? "")} />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/**
 * Custom skills under the skill table. Deleting one leaves the test options on
 * it, which say so (rolls/testOptionRules.ts).
 */
export function CustomSkills() {
    return (
        <ItemGrid
            dataId="customSkills.list.items"
            id="custom-skills"
            itemClass="custom-skill"
            renderItem={id => <CustomSkill itemId={id} />}
        />
    );
}
