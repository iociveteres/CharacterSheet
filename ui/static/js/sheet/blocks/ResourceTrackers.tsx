import { joinPath, usePath } from "../components/context";
import { NumberField, TextField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";

function ResourceTracker({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="resource-tracker">
            <TextField field="name" class="long" />
            <NumberField field="value" class="short" />
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

export function ResourceTrackers() {
    return (
        <div class="layout-column">
            <h3>Resource Trackers</h3>
            <ItemGrid
                dataId="resourceTrackers.list.items"
                id="resource-trackers"
                itemClass="resource-tracker"
                renderItem={id => <ResourceTracker itemId={id} />}
            />
        </div>
    );
}
