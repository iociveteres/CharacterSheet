import { initToggleContent, initDelete } from "../elementsUtils.js";
import { initRollableRating } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";


export class PowerShield {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'power-shield-item-template');
        }

        // Store references to elements
        this.nameEl = this.container.querySelector('[data-id="name"]');
        this.ratingEl = this.container.querySelector('[data-id="rating"]');
        this.natureEl = this.container.querySelector('[data-id="nature"]');
        this.typeEl = this.container.querySelector('[data-id="type"]');
        this.descEl = this.container.querySelector('[data-id="description"]');

        // Wire up toggle and delete functionality
        initToggleContent(this.container, {
            toggle: ".toggle-button",
            content: ".collapsible-content"
        });
        //setInitialCollapsedState(this.container);
        initDelete(this.container, ".delete-button");

        initRollableRating(this.container);
    }

    setValue(data) {
        if (data.name !== undefined) this.nameEl.value = data.name;
        if (data.rating !== undefined) this.ratingEl.value = data.rating;
        if (data.nature !== undefined) this.natureEl.value = data.nature;
        if (data.type !== undefined) this.typeEl.value = data.type;
        if (data.description !== undefined) this.descEl.value = data.description;
    }

    getValue() {
        return {
            name: this.nameEl.value,
            rating: this.ratingEl.value,
            nature: this.natureEl.value,
            type: this.typeEl.value,
            description: this.descEl.value
        };
    }

}
