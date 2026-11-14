import { afterEach, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { flush, loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../kinds/computed";
import { updateSignalAtPath } from "../core/sync";
import { allSustained } from "./artsRules";
import { Psykana } from "./Powers";

vi.mock("./artsRules", async original => {
    const rules = await original<typeof import("./artsRules")>();
    return { ...rules, allSustained: vi.fn(rules.allSustained) };
});

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const N = 6;

let rendered: Rendered | null = null;
afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

it("builds the list of sustained powers once per edit for the pills of all powers", async () => {
    const ids = Array.from({ length: N }, (_, i) => `p${i}`);
    loadState({
        characteristics: { W: { value: "40" }, I: { value: "45" } },
        psykana: {
            tabs: {
                items: {
                    t1: {
                        name: "Tab",
                        powers: {
                            items: Object.fromEntries(ids.map(id => [id, { name: id, sustained: "Free", sustain: { copies: 1, pr: 2 } }])),
                            layouts: Object.fromEntries(ids.map((id, i) => [id, pos(0, i)])),
                        },
                    },
                },
                layouts: { t1: pos(0, 0) },
            },
        },
    });
    attachComputeds(testState());
    rendered = renderBlock(<Psykana />);
    await flush();
    expect(rendered.container.querySelectorAll("[data-id=sustainPill]")).toHaveLength(N);

    vi.mocked(allSustained).mockClear();
    act(() => updateSignalAtPath(testState(), "psykana.tabs.items.t1.powers.items.p0.name", "Shield"));
    await flush();
    expect(allSustained).toHaveBeenCalledTimes(1);
});
