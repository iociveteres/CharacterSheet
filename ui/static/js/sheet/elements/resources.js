import { initDelete } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";


export class ResourceTracker {
    constructor(container) {
        this.container = container;
        if (container.children.length === 0) {
            createItemFromTemplate(container, 'resource-tracker-item-template');
        }

        initDelete(this.container, ".delete-button");
    }
}
