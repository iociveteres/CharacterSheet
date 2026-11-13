import { afterEach, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { options, type VNode } from "preact";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../kinds/computed";
import { updateSignalAtPath } from "../core/sync";
import { MeleeAttacks } from "../weapons/Attacks";
import { ModdedField } from "./ModdedField";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

let rendered: Rendered | null = null;
const diffed = options.diffed;
afterEach(() => {
    options.diffed = diffed;
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

it("does not render a total again when an edit leaves it the same", () => {
    loadState({
        characteristics: { S: { value: "42" }, WS: { value: "35" } },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "Chainaxe",
                        tabs: {
                            items: {
                                t1: {
                                    profile: "axe", damage: "1d10+2",
                                    damageMods: { items: { d1: { expr: "S.b", enabled: true } }, layouts: { d1: pos(0, 0) } },
                                },
                            },
                            layouts: { t1: pos(0, 0) },
                        },
                    },
                },
                layouts: { m1: pos(0, 0) },
            },
        },
    });
    attachComputeds(testState());
    rendered = renderBlock(<MeleeAttacks />);
    const total = () => rendered!.container.querySelector<HTMLInputElement>('[data-id="damageTotal"]')!.value;
    expect(total()).toBe("1d10+6");

    let renders = 0;
    options.diffed = (vnode: VNode) => {
        if (vnode.type === ModdedField) renders++;
        diffed?.(vnode);
    };
    // S 43 keeps S.b 4.
    act(() => updateSignalAtPath(testState(), "characteristics.S.value", "43"));
    expect(total()).toBe("1d10+6");
    expect(renders).toBe(0);

    act(() => updateSignalAtPath(testState(), "characteristics.S.value", "52"));
    expect(total()).toBe("1d10+7");
});
