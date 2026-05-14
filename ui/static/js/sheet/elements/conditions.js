import { initDelete, setupConditionalFields } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";

export class ConditionItem {
    constructor(container, init) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'condition-item-template');
            this.init = { enabled: true, rowType: 'bonus' };
        }

        initDelete(this.container, '.delete-button');

        // Show/hide bonus and cap rows based on the rowType select
        setupConditionalFields(this.container, '[data-id="rowType"]', {
            '.bonus-input': ['bonus', 'both'],
            '.cap-input': ['cap', 'both'],
        }, 'field-hidden');
    }
}