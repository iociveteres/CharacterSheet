// Init sequence for the Black Crusade sheet layout
// (ui/html/kinds/black_crusade.html).
import {
    gridSettings,
    makeCreateEntryGrid,
    initCharacteristics,
    initCustomSkills,
    initResourceTrackers,
    initPowerShields,
    initRangedAttacks,
    initMeleeAttacks,
    initNotes,
    initTalents,
    initTraits,
    initGear,
    initCybernetics,
    initExperienceLog,
    initMutations,
    initMentalDisorders,
    initDiseases,
    initSkillsTable,
    initArmourTotals,
    initPsychicPowersTabs,
    initTechPowersTabs,
    initConditions,
} from "../blocks.js";

import { initCompensationRoll } from "../elements/tech.js";
import { initializeRollDefaults } from "../elements/util/rollHelpers.js";
import { initInitiative } from "../elements/initiative.js";
import { initMovement } from "../elements/movement.js";
import { fatigueIndicator } from "../elements/fatigue.js";
import { initRolls } from "../rolls.js";
import { mountPrototype, prototypeEnabled } from "../prototype/index";

export function init(ctx) {
    // Dev builds can swap Talents and Conditions for the Preact prototype.
    const prototype = __DEV__ && prototypeEnabled();
    if (prototype) mountPrototype(ctx.root);

    ctx.characteristicBlocks = initCharacteristics(ctx.root);
    ctx.settings = gridSettings(ctx.socket);
    ctx.createEntryGrid = makeCreateEntryGrid(ctx.socket);

    initializeRollDefaults();

    initCustomSkills(ctx);
    initResourceTrackers(ctx);
    initPowerShields(ctx);
    initRangedAttacks(ctx);
    initMeleeAttacks(ctx);
    initNotes(ctx);
    if (!prototype) initTalents(ctx);
    initTraits(ctx);
    initGear(ctx);
    initCybernetics(ctx);
    initExperienceLog(ctx);
    initMutations(ctx);
    initMentalDisorders(ctx);
    initDiseases(ctx);

    initSkillsTable(ctx.root);
    initArmourTotals(ctx.root);
    initPsychicPowersTabs(ctx);
    initTechPowersTabs(ctx);
    initCompensationRoll(ctx.root);
    if (!prototype) initConditions(ctx);

    fatigueIndicator();

    initRolls(ctx.root, ctx.characteristicBlocks);
    initInitiative();
    initMovement();
}
