// Paths of the blocks that Preact renders. network.js applies remote changes
// under these paths to the state only; old blocks still get DOM events.

/**
 * Top-level state keys of the blocks that Preact renders on every sheet.
 * Their Go templates are empty mount points, so the markup holds no values
 * for them and the markup reconciliation (state/reconcile.ts) skips them.
 */
export const PREACT_BLOCK_PATHS: readonly string[] = [
    "conditions",
    "customSkills",
    "notes",
    "resourceTrackers",
    "powerShields",
    "traits",
    "talents",
    "mutations",
    "mentalDisorders",
    "diseases",
    "carryWeightAndEncumbrance",
    "gear",
    "cybernetics",
    "experience",
    "characterInfo",
    "characteristics",
    "skillsLeft",
    "skillsRight",
    "infamyPoints",
    "fatigue",
    "initiative",
    "size",
    "movement",
    "armour",
];

/** Whether `path` is one of `prefixes` or lies under one of them. */
export const isUnder = (prefixes: readonly string[], path: string): boolean =>
    prefixes.some(p => path === p || path.startsWith(`${p}.`));

/** Whether the state at `path` belongs to a block that Preact renders. */
export const isMigratedPath = (path: string): boolean => isUnder(PREACT_BLOCK_PATHS, path);
