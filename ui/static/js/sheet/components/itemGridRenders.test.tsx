import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { options, type ComponentType, type VNode } from "preact";
import { flush, loadState, renderBlock, teardownSheet, testState, type Rendered } from "./testUtils";
import { attachComputeds } from "../kinds/computed";
import { Psykana } from "../magic/Powers";
import { Gear } from "../gear/Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (ids: string[], item: (id: string) => object) => ({
    items: Object.fromEntries(ids.map(id => [id, item(id)])),
    layouts: Object.fromEntries(ids.map((id, i) => [id, pos(0, i)])),
});

let rendered: Rendered | null = null;
const diffed = options.diffed;
afterEach(() => {
    options.diffed = diffed;
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

/** The item ids that components named `name` rendered while `act` ran. */
async function renders(name: string, action: () => void): Promise<string[]> {
    const ids: string[] = [];
    options.diffed = (vnode: VNode) => {
        if (typeof vnode.type === "function" && (vnode.type as ComponentType).name === name) ids.push((vnode as VNode<{ itemId: string }>).props.itemId);
        diffed?.(vnode);
    };
    act(action);
    await flush();
    options.diffed = diffed;
    return ids;
}

const click = (selector: string) => () => rendered!.container.querySelector<HTMLButtonElement>(selector)!.click();

describe("a grid of items", () => {
    it("renders only the new power when one is added, and none when one is deleted", async () => {
        loadState({
            psykana: {
                tabs: { items: { t1: { name: "Tab", powers: grid(["p0", "p1", "p2"], id => ({ name: id, damage: "1d10" })) } }, layouts: { t1: pos(0, 0) } },
            },
        });
        attachComputeds(testState());
        rendered = renderBlock(<Psykana />);
        await flush();

        const added = await renders("Power", click('[data-id="powers.items"] .add-button'));
        expect(added).toHaveLength(1);
        expect(["p0", "p1", "p2"]).not.toContain(added[0]);

        expect(await renders("Power", click('[data-id="p1"] .delete-button'))).toEqual([]);
        expect(rendered.container.querySelectorAll(".psychic-power")).toHaveLength(3);
    });

    it("renders only the new gear item when one is added", async () => {
        loadState({ gear: { list: grid(["g0", "g1", "g2"], id => ({ name: id })) } });
        attachComputeds(testState());
        rendered = renderBlock(<Gear useAttacks={() => ({ row: null, addButton: null })} />);
        await flush();

        const added = await renders("GearItemView", click("#gear .add-button"));
        expect(added).toHaveLength(1);
        expect(["g0", "g1", "g2"]).not.toContain(added[0]);
    });
});
