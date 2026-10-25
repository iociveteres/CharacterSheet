import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, recordingActions, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath } from "../state/sync";
import { MeleeAttacks } from "./Attacks";
import { Movement } from "./Combat";
import { MeleeAttacksHeading } from "./Stances";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const meleeRoll = {
    base: { selected: "standard", standard: 10 }, rof: { selected: "single", single: 0 },
    extra1: { name: "", value: 0, enabled: false }, extra2: { name: "", value: 0, enabled: false }, testOption: "ws",
};

/** A Longsword and a Heater Shield in the stance `stance`, the stances shown unless `shown` is false. */
function load(stance = "", shown?: boolean) {
    loadState({
        characteristics: { WS: { value: "45" }, A: { value: "30" } },
        movement: { modes: { items: { m1: { name: "Land", spd: "A.b" } }, layouts: { m1: pos(0, 0) } } },
        settings: shown === undefined ? {} : { meleeAttacks: { stances: shown } },
        meleeAttacks: {
            stance,
            testOptions: { items: { ws: { base: "WS" } }, layouts: { ws: pos(0, 0) } },
            list: {
                items: {
                    m1: { name: "Longsword", balance: "2", roll: meleeRoll, tabs: { items: { t1: { profile: "sword" } }, layouts: { t1: pos(0, 0) } } },
                    m2: {
                        name: "Heater Shield", group: "primary (shield)", shield: { ap: 4, defenseSectors: "A1+T+(H)", equipped: true },
                        tabs: { items: { t1: { profile: "shield", special: "Defensive" } }, layouts: { t1: pos(0, 0) } },
                    },
                },
                layouts: { m1: pos(0, 0), m2: pos(0, 1) },
            },
        },
    });
    attachComputeds(testState());
}

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const changes = (actions: ReturnType<typeof recordingActions>) => [...actions.sent, ...actions.scheduled.map(([msg]) => msg)];
const button = (key: string) => $<HTMLButtonElement>(`[data-stance="${key}"]`)!;

describe("the stances over the melee attacks", () => {
    it("are six toggles, the current one on, one without a weapon for it dimmed but still taken", () => {
        load("aggressive");
        const actions = recordingActions();
        rendered = renderBlock(<MeleeAttacksHeading />, { actions });
        expect(Array.from(rendered.container.querySelectorAll(".stance-button"), b => b.textContent))
            .toEqual(["Standard", "Aggressive", "Defensive", "Covering", "Springy", "Palisade"]);
        expect(button("aggressive").classList.contains("on")).toBe(true);
        expect(button("springy").classList.contains("unavailable")).toBe(false);
        const palisade = button("palisade");
        expect(palisade.className).toBe("stance-button unavailable");
        expect(palisade.title.split("\n").slice(1)).toEqual(["Needs a glaive, spear or bayonet", "No glaive, spear or bayonet among the melee attacks"]);
        expect(palisade.disabled).toBe(false);

        act(() => palisade.click());
        act(() => button("standard").click());
        expect(changes(actions)).toEqual([
            expect.objectContaining({ type: "change", path: "meleeAttacks.stance", change: "palisade" }),
            expect.objectContaining({ type: "change", path: "meleeAttacks.stance", change: "" }),
        ]);
    });

    it("hide under ▴, which the sheet keeps; hidden, the heading names a stance other than Standard", () => {
        load("aggressive");
        const actions = recordingActions();
        rendered = renderBlock(<MeleeAttacksHeading />, { actions });
        act(() => $<HTMLButtonElement>(".stance-corner-button")!.click());
        expect(changes(actions)).toEqual([expect.objectContaining({ path: "settings.meleeAttacks.stances", change: false })]);
        act(() => updateSignalAtPath(testState(), "settings.meleeAttacks.stances", false));
        expect($(".stance-grid")).toBeNull();
        const corner = $<HTMLButtonElement>(".stance-corner-button")!;
        expect(corner.textContent).toBe("Aggressive ▾");
        expect(corner.classList.contains("current")).toBe(true);
        act(() => updateSignalAtPath(testState(), "meleeAttacks.stance", ""));
        expect($(".stance-corner-button")!.textContent).toBe("Stance ▾");
        expect($(".stance-corner-button")!.classList.contains("current")).toBe(false);
    });

    it("show for a sheet saved before the setting", () => {
        load("");
        rendered = renderBlock(<MeleeAttacksHeading />);
        expect($(".stance-grid")).not.toBeNull();
    });
});

describe("the Defensive stance", () => {
    it("says what the shield's zones in brackets do", () => {
        load("");
        rendered = renderBlock(<MeleeAttacks />);
        expect($('[data-id="zonesNote"]')!.textContent).toBe("(H) only in Defensive stance");
        act(() => updateSignalAtPath(testState(), "meleeAttacks.stance", "defensive"));
        expect($('[data-id="zonesNote"]')!.textContent).toBe("(H) covered: Defensive stance");
    });

    it("notes at the roll that it allows no attacks, which still roll", () => {
        load("defensive");
        rendered = renderBlock(<MeleeAttacks />);
        act(() => $<HTMLElement>('[data-id="m1"] .name label')!.click());
        expect($('[data-id="m1"] .no-attacks')!.textContent).toBe("No attacks");
        expect($<HTMLButtonElement>('[data-id="m1"] [data-id="rollButton"]')!.disabled).toBe(false);
    });
});

describe("the Palisade stance", () => {
    it("dims Charge and Run in the movement table", () => {
        load("palisade");
        rendered = renderBlock(<Movement />);
        const heads = Array.from(rendered.container.querySelectorAll("thead th"), th => [th.textContent, th.classList.contains("dimmed")]);
        expect(heads).toEqual([["", false], ["Half", false], ["Full", false], ["Charge", true], ["Run", true]]);
        expect($<HTMLInputElement>('[data-id="run"]')!.classList.contains("dimmed")).toBe(true);
        expect($("th.dimmed")!.title).toBe("Palisade stance: no Charge or Run");
    });
});
