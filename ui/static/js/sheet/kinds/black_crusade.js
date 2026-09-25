// Init sequence for the Black Crusade sheet layout
// (ui/html/kinds/black_crusade.html).
import {
    gridSettings,
    initCharacteristics,
    initRangedAttacks,
    initMeleeAttacks,
    initSkillsTable,
    initArmourTotals,
    initPsychicPowersTabs,
    initTechPowersTabs,
} from "../blocks.js";

import { initCompensationRoll } from "../elements/tech.js";
import { initializeRollDefaults } from "../elements/util/rollHelpers.js";
import { initInitiative } from "../elements/initiative.js";
import { initMovement } from "../elements/movement.js";
import { fatigueIndicator } from "../elements/fatigue.js";
import { initRolls } from "../rolls.js";
import { mountBlocks } from "../blocks/index";

export function init(ctx) {
    ctx.characteristicBlocks = initCharacteristics(ctx.root);
    ctx.settings = gridSettings(ctx.socket);

    initializeRollDefaults();
    mountBlocks(ctx.root);

    initRangedAttacks(ctx);
    initMeleeAttacks(ctx);

    initSkillsTable(ctx.root);
    initArmourTotals(ctx.root);
    initPsychicPowersTabs(ctx);
    initTechPowersTabs(ctx);
    initCompensationRoll(ctx.root);

    fatigueIndicator();

    initRolls(ctx.root, ctx.characteristicBlocks);
    initInitiative();
    initMovement();
}
