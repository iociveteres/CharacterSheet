import { afterEach, expect, it, vi } from "vitest";
import { computed, effect } from "@preact/signals-core";
import { conditionOf, loadState, teardownSheet } from "../components/testUtils";
import { attachComputeds } from "../kinds/computed";
import { updateSignalAtPath } from "../core/sync";
import { idsInOrder } from "../core/gridOrder";
import { weaponBonuses } from "./weaponBonus";

vi.mock("../core/gridOrder", async original => {
    const order = await original<typeof import("../core/gridOrder")>();
    return { ...order, idsInOrder: vi.fn(order.idsInOrder) };
});

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const N = 6;

afterEach(teardownSheet);

it("does not read the names of the weapons again when a source of weapon entries is renamed", () => {
    const ids = Array.from({ length: N }, (_, i) => `r${i}`);
    const conditions = conditionOf(
        { type: "weapon_bonus", name: "Ranged", weaponField: "reload", weaponBonus: "1" },
        { type: "weapon_bonus", name: "r1", weaponField: "reload", weaponBonus: "1" },
    );
    const state = loadState({
        conditions,
        rangedAttacks: {
            list: {
                items: Object.fromEntries(ids.map(id => [id, { name: id, class: "rifle" }])),
                layouts: Object.fromEntries(ids.map((id, i) => [id, pos(0, i)])),
            },
        },
    });
    attachComputeds(state);
    // The Reload of each weapon reads its bonuses, which are labelled by the name of their source.
    const bonuses = ids.map(id => computed(() => weaponBonuses(state, `rangedAttacks.list.items.${id}`, "reload")));
    const dispose = effect(() => bonuses.forEach(b => void b.value));
    expect(bonuses[1].value.map(b => b.label)).toEqual(["Test", "Test"]);

    vi.mocked(idsInOrder).mockClear();
    updateSignalAtPath(state, "conditions.list.items.c1.name", "Drill");
    expect(bonuses[1].value.map(b => b.label)).toEqual(["Drill", "Drill"]);
    expect(vi.mocked(idsInOrder).mock.calls.filter(([, path]) => path === "rangedAttacks.list.items")).toEqual([]);
    dispose();
});
