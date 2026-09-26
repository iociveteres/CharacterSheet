import { joinPath, usePath } from "../components/context";
import { NumberField, Select, TextField, peekAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { CHARACTERISTIC_KEYS } from "../schema/constants";
import { AdvanceCheckboxes, Difficulty } from "./skillParts";

function CustomSkill({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="custom-skill">
            <TextField field="name" class="long" />
            <Select field="characteristic" options={CHARACTERISTIC_KEYS} />
            <AdvanceCheckboxes rowPath={path} />
            <NumberField field="miscBonus" class="short textlike" />
            <Difficulty rowPath={path} label={() => String(peekAt(`${path}.name`) ?? "")} />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** Custom skills under the skill table. */
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
