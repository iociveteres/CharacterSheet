import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, recordingActions, teardownSheet, testSheet, testState } from "../components/testUtils";
import { activateTechPower, castPower, compensate, type Activation, type Cast } from "./cast";
import { attachComputeds } from "./computed";
import { updateSignalAtPath, valueAt } from "./sync";

const P = "psykana.tabs.items.t1.powers.items.p1";
const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

beforeEach(() => {
    loadState({
        psykana: {
            basePR: 5,
            tabs: {
                items: { t1: { name: "Tab", powers: { items: { p1: { name: "Shield", sustained: "Free action" } }, layouts: { p1: pos(0, 0) } } } },
                layouts: { t1: pos(0, 0) },
            },
        },
    });
    attachComputeds(testState());
});

afterEach(() => teardownSheet());

const cast = (over: Partial<Cast> = {}): Cast =>
    ({ effectivePR: 3, kick: 0, safe: false, target: 50, bonusSuccesses: 0, label: "Shield", sustain: { free: false }, ...over });

/** Casts with `over`; returns the cast's promise and its test's requestId. */
function send(over: Partial<Cast> = {}): { done: Promise<void>; requestId: string } {
    let requestId = "";
    const listener = (e: Event) => { requestId = (e as CustomEvent).detail.requestId; };
    document.addEventListener("sheet:rollVersus", listener);
    const done = castPower(testSheet(), P, cast(over));
    document.removeEventListener("sheet:rollVersus", listener);
    return { done, requestId };
}

function answer(requestId: string, outcome: { roll: number; success: boolean; doubles: boolean }): void {
    document.dispatchEvent(new CustomEvent("sheet:rollResult", {
        detail: { requestId, outcome: { target: 50, degrees: 1, crit: false, ...outcome } },
    }));
}

describe("castPower", () => {
    it("records the cast before its test is back and sustains the power once it succeeds", async () => {
        const { done, requestId } = send({ kick: 1 });
        expect([valueAt(testState(), `${P}.cast.pr`), valueAt(testState(), `${P}.cast.kick`), valueAt(testState(), "psykana.lastCastPower")]).toEqual([4, 1, "p1"]);
        // Pushed: phenomena whatever the test.
        expect(valueAt(testState(), `${P}.cast.phenomena`)).toBe("pushed");
        expect(valueAt(testState(), `${P}.sustain.copies`)).toBe(0);

        answer(requestId, { roll: 20, success: true, doubles: false });
        await done;
        expect([valueAt(testState(), `${P}.sustain.copies`), valueAt(testState(), `${P}.sustain.pr`)]).toEqual([1, 4]);
    });

    it("leaves the sustaining alone when the test fails or the cast is not to be sustained", async () => {
        const failed = send();
        answer(failed.requestId, { roll: 70, success: false, doubles: false });
        await failed.done;
        expect(valueAt(testState(), `${P}.sustain.copies`)).toBe(0);

        const unsustained = send({ sustain: null });
        answer(unsustained.requestId, { roll: 22, success: true, doubles: true });
        await unsustained.done;
        expect(valueAt(testState(), `${P}.sustain.copies`)).toBe(0);
        expect(valueAt(testState(), `${P}.cast.phenomena`)).toBe("doubles");
    });

    it("adds a copy of a Repeatable power for each test that succeeds, cast before the others are back", async () => {
        updateSignalAtPath(testState(), `${P}.subtypes`, "Repeatable (3)");
        const first = send();
        const second = send();
        answer(first.requestId, { roll: 20, success: true, doubles: false });
        answer(second.requestId, { roll: 30, success: true, doubles: false });
        await Promise.all([first.done, second.done]);
        expect(valueAt(testState(), `${P}.sustain.copies`)).toBe(2);
    });
});

describe("activateTechPower", () => {
    const T = "technoArcana.tabs.items.t1.powers.items.p1";

    beforeEach(() => {
        loadState({
            technoArcana: {
                currentCognition: 5,
                currentEnergy: 1,
                tabs: {
                    items: {
                        t1: {
                            name: "Tab",
                            powers: {
                                items: { p1: { name: "Crown", price: "3 ⚙, 3 🗲", process: "1 ⚙, 1 🗲(У)" } },
                                layouts: { p1: pos(0, 0) },
                            },
                        },
                    },
                    layouts: { t1: pos(0, 0) },
                },
            },
        });
        attachComputeds(testState());
    });

    function activate(over: Partial<Activation> = {}): { done: Promise<void>; requestId: string } {
        let requestId = "";
        const listener = (e: Event) => { requestId = (e as CustomEvent).detail.requestId; };
        document.addEventListener("sheet:rollVersus", listener);
        const done = activateTechPower(testSheet(), T, {
            x: 0, process: true, test: { target: 50, bonusSuccesses: 0, label: "Crown" }, energyAsFatigue: 0, ...over,
        });
        document.removeEventListener("sheet:rollVersus", listener);
        return { done, requestId };
    }

    /** Cognition, energy, Fatigue and the copies of the power in Processes. */
    const resources = () => [
        valueAt(testState(), "technoArcana.currentCognition"), valueAt(testState(), "technoArcana.currentEnergy"), valueAt(testState(), "fatigue.fatigueCur"), valueAt(testState(), `${T}.inProcess.copies`),
    ];

    it("spends ⚙ before the test, 🗲 once it succeeds with Fatigue for what it lacks, and holds the power in a Process", async () => {
        const { done, requestId } = activate();
        expect(resources()).toEqual([2, 1, 0, 0]);
        answer(requestId, { roll: 20, success: true, doubles: false });
        await done;
        // 3 🗲: the 1 there is, 2 Fatigue.
        expect(resources()).toEqual([2, 0, 2, 1]);
    });

    it("pays the 🗲 chosen with Fatigue and keeps the energy", async () => {
        updateSignalAtPath(testState(), "technoArcana.currentEnergy", 5);
        await activate({ test: null, energyAsFatigue: 2 }).done;
        expect(resources()).toEqual([2, 4, 2, 1]);
    });

    it("spends only ⚙ on a failed test", async () => {
        const { done, requestId } = activate();
        answer(requestId, { roll: 80, success: false, doubles: false });
        await done;
        expect(resources()).toEqual([2, 1, 0, 0]);
    });

    it("activates a power without a test at once, and leaves the Process when told to", async () => {
        const { done, requestId } = activate({ test: null, process: false });
        expect(requestId).toBe("");
        await done;
        expect(resources()).toEqual([2, 0, 2, 0]);
    });

    it("spends nothing and holds no Process while the sheet does not count them", async () => {
        updateSignalAtPath(testState(), "settings.technoArcana.price", false);
        updateSignalAtPath(testState(), "settings.technoArcana.processes", false);
        const { done, requestId } = activate();
        answer(requestId, { roll: 20, success: true, doubles: false });
        await done;
        expect(resources()).toEqual([5, 1, 0, 0]);
    });

    it("offers a Compensator power's compensation, and gives back the Fatigue first for each Success", async () => {
        updateSignalAtPath(testState(), `${T}.subtypes`, "Компенсатор (2), Славословие (1)");
        await activate({ test: null }).done;
        // 3 🗲: 1 of energy, 2 of Fatigue.
        expect(["power", "x", "energy", "fatigue"].map(f => valueAt(testState(), `technoArcana.compensation.${f}`))).toEqual(["p1", 2, 1, 2]);
        expect(valueAt(testState(), "technoArcana.compensationRoll.modifier")).toBe(2);

        compensate(testSheet(), 3, "p1");
        expect(resources()).toEqual([2, 1, 0, 1]);
        expect(valueAt(testState(), "technoArcana.compensation.power")).toBe("");
    });

    it("gives back the 🗲 up to the maximum of energy", async () => {
        updateSignalAtPath(testState(), `${T}.subtypes`, "Компенсатор (2)");
        updateSignalAtPath(testState(), "technoArcana.currentEnergy", 3);
        await activate({ test: null }).done;
        // Recharged before the compensation roll: 3 of 3.
        updateSignalAtPath(testState(), "technoArcana.currentEnergy", 3);
        compensate(testSheet(), 3, "p1");
        expect(valueAt(testState(), "technoArcana.currentEnergy")).toBe(3);
    });

    it("keeps only the last activation to compensate, and gives nothing back for a roll of a replaced one", async () => {
        updateSignalAtPath(testState(), `${T}.subtypes`, "Компенсатор (2)");
        updateSignalAtPath(testState(), "technoArcana.currentEnergy", 5);
        await activate({ test: null }).done;
        expect(valueAt(testState(), "technoArcana.compensation.power")).toBe("p1");
        compensate(testSheet(), 3, "p0");
        expect(valueAt(testState(), "technoArcana.currentEnergy")).toBe(2);

        // Another activation, even a failed one without a Compensator, settles it as paid.
        updateSignalAtPath(testState(), `${T}.subtypes`, "");
        const failed = activate();
        answer(failed.requestId, { roll: 80, success: false, doubles: false });
        await failed.done;
        expect(valueAt(testState(), "technoArcana.compensation.power")).toBe("");
        expect(valueAt(testState(), "technoArcana.compensationRoll.modifier")).toBe(2);
    });

    it("uses a compilation of a Litany on a successful activation, not on a failed one", async () => {
        updateSignalAtPath(testState(), `${T}.subtypes`, "Славословие (1)");
        updateSignalAtPath(testState(), `${T}.compiled`, 2);
        const failed = activate();
        answer(failed.requestId, { roll: 80, success: false, doubles: false });
        await failed.done;
        expect(valueAt(testState(), `${T}.compiled`)).toBe(2);
        await activate({ test: null }).done;
        expect(valueAt(testState(), `${T}.compiled`)).toBe(1);
    });

    it("pays X for a price of X and keeps it for the Process", async () => {
        updateSignalAtPath(testState(), `${T}.price`, "X ⚙");
        updateSignalAtPath(testState(), `${T}.process`, "X ⚙(У)");
        await activate({ x: 4, test: null }).done;
        expect(resources()).toEqual([1, 1, 0, 1]);
        expect(valueAt(testState(), `${T}.inProcess.x`)).toBe(4);
    });
});
