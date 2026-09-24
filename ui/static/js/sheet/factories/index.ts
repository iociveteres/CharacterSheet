// New items of the grids that Preact renders. The createItem message carries
// the factory's object as init, and both clients build the item's signals
// from it with the schema's defaults, so they get the same item.
import { conditionEntryFactory, conditionFactory } from "./condition";
import { namedDescriptionFactory } from "./namedDescription";

export type ItemFactory = () => object;

const FACTORIES: [RegExp, ItemFactory][] = [
    [/^conditions\.list\.items$/, conditionFactory],
    [/^(conditions|gear|cybernetics)\.list\.items\.[^.]+\.entries\.items$/, conditionEntryFactory],
    [/^(notes|traits|talents|mutations|mentalDisorders|diseases)\.list\.items$/, namedDescriptionFactory],
];

/** The factory of new items of the grid at `gridPath`, or null when it has none. */
export function factoryFor(gridPath: string): ItemFactory | null {
    for (const [pattern, factory] of FACTORIES) {
        if (pattern.test(gridPath)) return factory;
    }
    return null;
}
