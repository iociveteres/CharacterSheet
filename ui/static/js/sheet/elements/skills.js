import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { initDelete } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { calculateTestDifficulty, calculateSkillAdvancement } from "../system.js";
import { createItemFromTemplate } from "./util/template.js";


export class CustomSkill {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'custom-skill-item-template');
        }

        this.selectEl = this.container.querySelector("select");
        this.checkboxEls = Array.from(
            this.container.querySelectorAll('input[type="checkbox"]')
        );
        this.difficultyInput = this.container.querySelector('input[data-id="difficulty"]');

        // interactivity is added to both skills and custom skills in initSkillsTable() in script.js
        initDelete(this.container, ".delete-button");
    }

    static attachComputeds(skillId) {
        const sk = characterState.customSkills?.list?.items?.[skillId];
        if (!sk) return;

        sk.difficulty = computed(() => {
            const charKey = sk.characteristic?.value || "WS";
            const c = characterState.characteristics?.[charKey];
            const charVal = (parseInt(c?.value?.value, 10) || 0)
                + ((c?.tempEnabled?.value ?? false) ? (parseInt(c?.tempValue?.value, 10) || 0) : 0);

            let count = 0;
            if (sk.plus0?.value) count++;
            if (sk.plus10?.value) count++;
            if (sk.plus20?.value) count++;
            if (sk.plus30?.value) count++;

            return calculateTestDifficulty(charVal, calculateSkillAdvancement(count))
                + (Number(sk.miscBonus?.value) || 0);
        });
    }
}
