import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { resetDragFreeze } from "../state/dragFreeze";
import { characterState } from "../state/state";
import { updateSignalAtPath, valueAt } from "../state/sync";
import { resetUiState } from "../state/ui";
import { TechnoArcana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const P = "technoArcana.tabs.items.t1.powers.items";
const roll = { testOption: "o1", modifier: 0, x: 0, extra1: {}, extra2: {} };

const content = () => ({
    characteristics: { I: { value: "45" } },
    technoArcana: {
        currentCognition: 4,
        currentEnergy: 0,
        testOptions: { items: { o1: { base: "I" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: {
                t1: {
                    name: "Luminen",
                    powers: {
                        items: {
                            p1: { name: "Luminen Shock", price: "1 ⚙, 1 🗲", process: "Нет", test: "Автоматически", roll },
                            p2: { name: "Litany", price: "3 ⚙, 2 🗲", process: "1 ⚙(У)", test: "Tech-Use(I)+0", roll },
                            p3: { name: "Doctrina Seraph", subtypes: "Доктрина", price: "2 ⚙", process: "1 ⚙", roll },
                            p4: { name: "Doctrina Fulgurite", subtypes: "Доктрина", price: "3 ⚙", process: "½ ⚙", inProcess: { copies: 1 }, roll },
                        },
                        layouts: { p1: pos(0, 0), p2: pos(0, 1), p3: pos(0, 2), p4: pos(0, 3) },
                    },
                },
            },
            layouts: { t1: pos(0, 0) },
        },
    },
});

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
    attachComputeds(characterState);
    rendered = renderBlock(<TechnoArcana />);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    resetDragFreeze();
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const power = (id: string, sel: string) => $(`[data-id="${id}"] ${sel}`);
const openRoll = (id: string) => act(() => power(id, ".name label")!.click());
const text = (sel: string) => $(sel)?.textContent ?? null;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("the activation of a tech power", () => {
    it("shows the price, what the character lacks, and activates a power tested automatically without a roll", async () => {
        openRoll("p1");
        expect(text('[data-id="p1"] [data-id="priceText"]')).toBe("1 ⚙, 1 🗲 on success");
        expect(text('[data-id="p1"] [data-id="noEnergy"]')).toBe("0 of 1 🗲: the rest as Fatigue");
        expect(power("p1", '[data-id="holdInProcess"]')).toBeNull();

        const rolls: unknown[] = [];
        const listener = (e: Event) => rolls.push(e);
        document.addEventListener("sheet:rollVersus", listener);
        const button = power("p1", '[data-id="rollButton"]') as HTMLButtonElement;
        expect(button.textContent).toBe("Activate");
        await act(async () => { button.click(); await flush(); });
        document.removeEventListener("sheet:rollVersus", listener);
        expect(rolls).toHaveLength(0);
        expect(valueAt("technoArcana.currentCognition")).toBe(3);
    });

    it("rolls the test and warns of the ⚙ it lacks", () => {
        openRoll("p2");
        expect(text('[data-id="p2"] [data-id="noCognition"]')).toBeNull();
        expect(power("p2", ".price-column")!.textContent).toContain("Process (unique)");
        const rolls: string[] = [];
        const listener = (e: Event) => rolls.push((e as CustomEvent).detail.label);
        document.addEventListener("sheet:rollVersus", listener);
        act(() => (power("p2", '[data-id="rollButton"]') as HTMLButtonElement).click());
        document.removeEventListener("sheet:rollVersus", listener);
        expect(rolls).toEqual(["Litany"]);
        expect(valueAt("technoArcana.currentCognition")).toBe(1);

        openRoll("p2");
        expect(text('[data-id="p2"] [data-id="noCognition"]')).toBe("1 of 3 ⚙: not enough to activate");
        expect((power("p2", '[data-id="rollButton"]') as HTMLButtonElement).disabled).toBe(true);
        // 2 🗲 on success, of which none is there.
        expect(power("p2", '[data-id="energyAsFatigue"]')).not.toBeNull();
        expect(text('[data-id="p2"] [data-id="noEnergy"]')).toBe("0 of 2 🗲: the rest as Fatigue");
    });

    it("says which Doctrine an activation ends", () => {
        openRoll("p3");
        expect(text('[data-id="p3"] [data-id="endsDoctrine"]')).toBe("Ends Doctrina Fulgurite");
    });
});

describe("the Processes", () => {
    const costTotal = () => $<HTMLInputElement>('[data-id="processCostTotal"]')!.value;

    it("cost a turn what the powers cost with the modifiers, and say when the next turn leaves too little ⚙ or 🗲", () => {
        // Doctrina Fulgurite ½ ⚙, rounded up; I 45: the turn restores 2 ⚙ to the 4 there are.
        expect(costTotal()).toBe("1 ⚙");
        expect($('[data-id="processShort"]')).toBeNull();

        act(() => $<HTMLButtonElement>(".process-cost .mod-toggle")!.click());
        act(() => $<HTMLButtonElement>('[data-id="processCost"] .add-button')!.click());
        const row = $<HTMLElement>('[data-id="processCost"] .resource-mod')!;
        act(() => {
            const expr = row.querySelector<HTMLInputElement>('[data-id="expr"]')!;
            expr.value = "3";
            expr.dispatchEvent(new Event("input", { bubbles: true }));
            const resource = row.querySelector<HTMLSelectElement>('[data-id="resource"]')!;
            resource.value = "energy";
            resource.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(costTotal()).toBe("1 ⚙, 3 🗲");

        act(() => {
            updateSignalAtPath(`${P}.p3.inProcess.copies`, 1);
            updateSignalAtPath("technoArcana.currentCognition", 0);
            updateSignalAtPath("technoArcana.currentEnergy", 3);
        });
        // ½ + 1 = 2 ⚙, the turn leaves 2: enough; with none restored, not. The coil holds the 3 🗲.
        expect($('[data-id="processShort"]')).toBeNull();
        act(() => updateSignalAtPath("technoArcana.cognitionRestore.base", "0"));
        expect(text('[data-id="processShort"]')).toBe("2 ⚙ short next turn: end some");
        // A turn restores no 🗲.
        act(() => updateSignalAtPath("technoArcana.currentEnergy", 1));
        expect(text('[data-id="processShort"]')).toBe("2 ⚙, 2 🗲 short next turn: end some");
    });

    it("mark the power and list it with what the Processes cost a turn; ✕ ends one", () => {
        expect(text('[data-id="p4"] [data-id="processPill"] .sustain-text')).toBe("Process ½ ⚙");
        expect(costTotal()).toBe("1 ⚙");
        expect(text('.process-list .sustain-name')).toBe("Doctrina Fulgurite");

        act(() => (power("p4", '[data-id="dropProcess"]') as HTMLButtonElement).click());
        expect(valueAt(`${P}.p4.inProcess.copies`)).toBe(0);
        expect(power("p4", '[data-id="processPill"]')).toBeNull();
        expect(costTotal()).toBe("0 ⚙");
    });

    it("are set by hand under the power's ⚙", () => {
        act(() => (power("p2", ".power-traits-toggle") as HTMLButtonElement).click());
        expect(power("p2", '[data-id="traits"]')!.textContent).toContain("Process 1 ⚙ a turn, unique: held once at most");
        act(() => (power("p2", '[data-id="inProcess"] [data-id="held"]') as HTMLInputElement).click());
        expect(valueAt(`${P}.p2.inProcess.copies`)).toBe(1);
        expect(costTotal()).toBe("2 ⚙");
    });

    it("are not listed nor offered while the sheet does not count them, and neither is the price", () => {
        act(() => (rendered!.container.querySelector<HTMLButtonElement>(".psykana-settings-toggle"))!.click());
        const rule = (field: string) => $<HTMLInputElement>(`[data-id="settings"] [data-id="technoArcana"] [data-id="${field}"]`)!;
        act(() => rule("processes").click());
        act(() => rule("price").click());
        expect(valueAt("settings.technoArcana.processes")).toBe(false);
        expect(power("p4", '[data-id="processPill"]')).toBeNull();
        expect($('[data-id="processCostTotal"]')).toBeNull();

        act(() => updateSignalAtPath("technoArcana.currentCognition", 0));
        openRoll("p2");
        // The price row is gone with both; the ⚙ it lacks stops nothing.
        expect(power("p2", ".price-column")).toBeNull();
        expect((power("p2", '[data-id="rollButton"]') as HTMLButtonElement).disabled).toBe(false);
    });
});

describe("a Litany", () => {
    it("is rolled only compiled, and each compilation is marked and dropped as a Process", () => {
        act(() => updateSignalAtPath(`${P}.p2.subtypes`, "Славословие (2)"));
        openRoll("p2");
        expect(text('[data-id="p2"] [data-id="notCompiled"]')).toBe("Not compiled: compile it first");
        const roll = () => power("p2", '[data-id="rollButton"]') as HTMLButtonElement;
        expect(roll().disabled).toBe(true);

        act(() => (power("p2", '[data-id="compile"]') as HTMLButtonElement).click());
        expect(valueAt(`${P}.p2.compiled`)).toBe(1);
        expect(roll().disabled).toBe(false);
        expect(text('[data-id="p2"] [data-id="compiledPill"] .sustain-text')).toBe("Compiled 1 ⚙");

        act(() => (power("p2", '[data-id="dropCompiled"]') as HTMLButtonElement).click());
        expect(valueAt(`${P}.p2.compiled`)).toBe(0);
        expect(power("p2", '[data-id="compiledPill"]')).toBeNull();
    });
});

describe("the Compensation Roll", () => {
    const due = (energy: number, fatigue: number) => act(() => {
        updateSignalAtPath("technoArcana.compensation.power", "p2");
        updateSignalAtPath("technoArcana.compensation.x", 1);
        updateSignalAtPath("technoArcana.compensation.energy", energy);
        updateSignalAtPath("technoArcana.compensation.fatigue", fatigue);
        // As the activation left it.
        updateSignalAtPath("fatigue.fatigueCur", fatigue);
    });
    const toggle = () => $<HTMLButtonElement>(".compensation-toggle")!;

    it("stands out after a Compensator activation paid, and its roll gives back one for each Success", async () => {
        expect(toggle().classList.contains("attention")).toBe(false);
        due(1, 1);
        expect(toggle().classList.contains("attention")).toBe(true);
        act(() => toggle().click());
        expect(text('[data-id="compensationDue"] span')).toBe("Litany, Compensator (1), paid 1 🗲 and 1 Fatigue");

        let request: { requestId: string; label: string } | null = null;
        const listener = (e: Event) => { request = (e as CustomEvent).detail; };
        document.addEventListener("sheet:rollVersus", listener);
        act(() => $<HTMLButtonElement>('[data-id="compensationRoll"] [data-id="rollButton"]')!.click());
        document.removeEventListener("sheet:rollVersus", listener);
        expect(request!.label).toBe("Compensator, Litany, X = 0");

        document.dispatchEvent(new CustomEvent("sheet:rollResult", {
            detail: { requestId: request!.requestId, outcome: { roll: 12, target: 30, success: true, degrees: 2, crit: false, doubles: false } },
        }));
        await act(async () => { await flush(); });
        expect([valueAt("fatigue.fatigueCur"), valueAt("technoArcana.currentEnergy")]).toEqual([0, 1]);
        expect(toggle().classList.contains("attention")).toBe(false);
    });

    it("lets the compensation go, keeping the price as paid", () => {
        due(2, 0);
        act(() => toggle().click());
        act(() => $<HTMLButtonElement>('[data-id="letGo"]')!.click());
        expect(valueAt("technoArcana.compensation.power")).toBe("");
        expect(valueAt("technoArcana.currentEnergy")).toBe(0);
        expect($('[data-id="compensationDue"]')).toBeNull();
    });
});
