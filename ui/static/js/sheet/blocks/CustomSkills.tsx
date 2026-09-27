import { joinPath, usePath, useSheet } from "../components/context";
import { NumberField, Select, TextField, peekAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { CHARACTERISTIC_KEYS } from "../schema/constants";
import { CUSTOM_SKILL_PREFIX } from "../state/rollBase";
import { testOptionsOn } from "../state/testOptions";
import { AdvanceCheckboxes, Difficulty } from "./skillParts";

function CustomSkill({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { actions } = useSheet();
    // The test options on the skill go with it; powers tested on them have no test.
    const remove = () => {
        for (const option of testOptionsOn(CUSTOM_SKILL_PREFIX + itemId)) actions.deleteItem(option);
        actions.deleteItem(path);
    };
    return (
        <Scope dataId={itemId} class="custom-skill">
            <TextField field="name" class="long" />
            <Select field="characteristic" options={CHARACTERISTIC_KEYS} />
            <AdvanceCheckboxes rowPath={path} />
            <NumberField field="miscBonus" class="short textlike" />
            <Difficulty rowPath={path} label={() => String(peekAt(`${path}.name`) ?? "")} />
            <DragHandle />
            <DeleteButton itemPath={path} onDelete={remove} />
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
