import { joinPath, usePath } from "../components/context";
import { NumberField, Select, TextField, peekAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { CHARACTERISTIC_KEYS } from "../schema/constants";
import { AdvanceCheckboxes, Difficulty, onAdvanceChange } from "./skillParts";

function CustomSkill({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="custom-skill" onChange={onAdvanceChange(path)}>
            <TextField field="name" class="long" />
            <Select field="characteristic" options={CHARACTERISTIC_KEYS} />
            <AdvanceCheckboxes />
            <NumberField field="miscBonus" class="short textlike" />
            <Difficulty rowPath={path} label={() => String(peekAt(`${path}.name`) ?? "")} />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** Custom skills under the skill table. The grid's id keeps network.js off their checkboxes. */
export function CustomSkills() {
    return (
        <ItemGrid
            dataId="customSkills.list.items"
            id="custom-skills"
            columns={1}
            itemClass="custom-skill"
            renderItem={id => <CustomSkill itemId={id} />}
        />
    );
}
