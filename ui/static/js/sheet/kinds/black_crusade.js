// Init sequence for the Black Crusade sheet layout
// (ui/html/kinds/black_crusade.html).
import {
    gridSettings,
    initPsychicPowersTabs,
    initTechPowersTabs,
} from "../blocks.js";

import { initCompensationRoll } from "../elements/tech.js";
import { initializeRollDefaults } from "../elements/util/rollHelpers.js";
import { mountBlocks } from "../blocks/index";

export function init(ctx) {
    ctx.settings = gridSettings(ctx.socket);

    initializeRollDefaults();
    mountBlocks(ctx.root);


    initPsychicPowersTabs(ctx);
    initTechPowersTabs(ctx);
    initCompensationRoll(ctx.root);


}
