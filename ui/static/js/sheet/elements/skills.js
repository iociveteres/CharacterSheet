import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { initDelete } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { sumEntryField } from "../state/computed.js";
import { calculateTestDifficulty, calculateSkillAdvancement } from "../system.js";
import { createItemFromTemplate } from "./util/template.js";
import { getItemVersion } from "../state/sync.js";
import { normalizeSkillName } from "../system.js";


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
            const char = characterState.characteristics?.[charKey];
            const val = char?.valueForRolls?.value
                ?? ((parseInt(char?.value?.value, 10) || 0)
                    + ((char?.tempEnabled?.value ?? false)
                        ? (parseInt(char?.tempValue?.value, 10) || 0) : 0));

            let count = 0;
            if (sk.plus0?.value) count++;
            if (sk.plus10?.value) count++;
            if (sk.plus20?.value) count++;
            if (sk.plus30?.value) count++;

            const skillName = normalizeSkillName(sk.name?.value ?? '');
            const skillCondBonus = skillName
                ? sumEntryField('skill_bonus', 'skillBonus',
                    e => normalizeSkillName(e.name?.value) === skillName)
                : 0;

            return calculateTestDifficulty(val, calculateSkillAdvancement(count))
                + (Number(sk.miscBonus?.value) || 0)
                + skillCondBonus;
        });
    }
}
