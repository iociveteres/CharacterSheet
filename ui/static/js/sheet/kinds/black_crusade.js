// Init sequence for the Black Crusade sheet layout
// (ui/html/kinds/black_crusade.html).
import {
    gridSettings,
    makeCreateEntryGrid,
    initCharacteristics,
    initRangedAttacks,
    initMeleeAttacks,
    initGear,
    initCybernetics,
    initExperienceLog,
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
    ctx.createEntryGrid = makeCreateEntryGrid(ctx.socket);

    initializeRollDefaults();
    mountBlocks(ctx.root);

    initRangedAttacks(ctx);
    initMeleeAttacks(ctx);
    initGear(ctx);
    initCybernetics(ctx);
    initExperienceLog(ctx);

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
