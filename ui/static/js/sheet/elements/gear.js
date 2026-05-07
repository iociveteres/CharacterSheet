import { initToggleContent, initDelete, initPasteHandler, applyPayload } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";


export class GearItem {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'gear-item-template');
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateInventoryItem(text);
        });
    }

    parseInventoryItem(paste) {
        // 1. Split off the description (everything after the first newline)
        const [headerLine, ...restLines] = paste.split(/\r?\n/);
        const description = restLines.join("\n").trim();

        // 2. From the header line, extract the name
        //    Look for text between "|" and "W:"
        //    /\|\s*(.*?)\s*W:/ 
        const nameMatch = headerLine.match(/\|\s*(.*?)\s*W:/);
        const name = nameMatch ? nameMatch[1] : "";

        // 3. Extract the raw weight string (e.g. "1кг", "2.5 kg")
        const weightMatch = headerLine.match(/W:(.+)$/);
        const raw = weightMatch ? weightMatch[1].trim() : "";

        // 4. Strip to just the number (digits and optional decimal point)
        const numMatch = raw.match(/[\d.]+/);
        const weight = parseFloat(numMatch ? numMatch[0] : "0");

        return { name, weight, description };
    }

    populateInventoryItem(paste) {
        const payload = this.parseInventoryItem(paste);
        applyPayload(this.container, payload);
        return payload;
    }
}
