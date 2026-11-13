import { afterEach, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { options, type VNode } from "preact";
import { conditionOf, flush, loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../kinds/computed";
import { updateSignalAtPath } from "../core/sync";
import { Conditions } from "../conditions/Conditions";
import { columnsFromLayout } from "../core/columns";

vi.mock("../core/columns", async original => {
    const columns = await original<typeof import("../core/columns")>();
    return { ...columns, columnsFromLayout: vi.fn(columns.columnsFromLayout) };
});

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const N = 6;

let rendered: Rendered | null = null;
const diffed = options.diffed;
afterEach(() => {
    options.diffed = diffed;
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

it("renders no skill bonus entry and lists the skills once when a custom skill is renamed", async () => {
    loadState({
        conditions: conditionOf(...Array.from({ length: N }, () => ({ type: "skill_bonus", name: "Void Pilot", skillBonus: "10" }))),
        customSkills: { list: { items: { c1: { name: "Void Pilot" } }, layouts: { c1: pos(0, 0) } } },
    });
    attachComputeds(testState());
    rendered = renderBlock(<Conditions />);
    await flush();
    const unmatched = () => rendered!.container.querySelectorAll(".entry-name.unmatched").length;
    expect(unmatched()).toBe(0);

    let renders = 0;
    options.diffed = (vnode: VNode) => {
        if (typeof vnode.type === "function" && vnode.type.name === "SkillNameField") renders++;
        diffed?.(vnode);
    };
    vi.mocked(columnsFromLayout).mockClear();
    act(() => updateSignalAtPath(testState(), "customSkills.list.items.c1.name", "Void Pilots"));
    await flush();
    // The skills are listed (skillGroups) by reading the order of the custom skills.
    expect(vi.mocked(columnsFromLayout).mock.calls.filter(([, , ids]) => [...ids].join() === "c1")).toHaveLength(1);
    expect(renders).toBe(N);
    expect(unmatched()).toBe(N);

    renders = 0;
    act(() => updateSignalAtPath(testState(), "customSkills.list.items.c1.name", "Void Pilotss"));
    await flush();
    expect(renders).toBe(0);
});
