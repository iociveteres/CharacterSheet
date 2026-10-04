// Helpers for component tests: a sheet state and a rendered block, with
// actions and an autocomplete that record their messages instead of sending them.
// loadState makes the state of the test; renderBlock and the actions use it.
import { render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { normalizeSheet } from "../schema/normalize";
import { BLACK_CRUSADE_STATS } from "../schema/constants";
import { sheetSchema, type SheetSignals } from "../schema/sheet";
import { buildState } from "../state/state";
import { createSheetActions, type SheetActions } from "../state/actions";
import { SheetUiState } from "../state/ui";
import { DragFreeze } from "../state/dragFreeze";
import { applyRemoteToState, type RemoteSheetMessage, type RemoteTarget } from "../state/remote";
import { createSheetRolls } from "../rollEvents";
import { SheetContext, type AutocompleteResult, type SheetEnv } from "./context";
import { Autocomplete } from "../autocomplete";
import { SheetScope } from "../lifecycle";
import type { RollDefaults } from "../payload";
import { Scope } from "./Scope";

/** What the test sets up that goes with its sheet: effects, mounted blocks, autocompletes. */
export const testScope = new SheetScope();

/** Runs `dispose` when the test's sheet is torn down. */
export const onSheetTeardown = (dispose: () => void) => testScope.onTeardown(dispose);

/** Tears down what the test's sheet set up. */
export function teardownSheet(): void {
    testScope.teardown();
}

let current: SheetSignals | null = null;
let lastEnv: SheetEnv | null = null;

/**
 * The state of a Black Crusade sheet with the normalized `content`, without
 * computeds (attachComputeds adds them); it becomes the state of the test.
 */
export function loadState(content: unknown): SheetSignals {
    current = buildState(sheetSchema, normalizeSheet(sheetSchema, content, { onGhost: () => {} }));
    return current;
}

/** The state loadState made last. */
export function testState(): SheetSignals {
    if (!current) throw new Error("No test state: call loadState first");
    return current;
}

/** A conditions block of one enabled condition with `entries`, in rows e0, e1, … */
export const conditionOf = (...entries: object[]) => ({
    list: {
        items: {
            c1: {
                name: "Test", enabled: true, stacks: 1,
                entries: {
                    items: Object.fromEntries(entries.map((e, i) => [`e${i}`, e])),
                    layouts: Object.fromEntries(entries.map((_, i) => [`e${i}`, { colIndex: 0, rowIndex: i }])),
                },
            },
        },
        layouts: { c1: { colIndex: 0, rowIndex: 0 } },
    },
});

export interface Sent {
    sent: object[];
    scheduled: [object, string][];
}

/** Real actions on `state` that record the messages instead of sending them. */
export function recordingActions(state: SheetSignals = testState()): SheetActions & Sent {
    const log: Sent = { sent: [], scheduled: [] };
    const actions = createSheetActions(state, {
        send: msg => log.sent.push(msg),
        schedule: (msg, key) => log.scheduled.push([msg, key]),
    });
    return Object.assign(actions, log);
}

/** An Autocomplete that records its queries instead of sending them; teardownSheet destroys it. */
export function recordingAutocomplete(): Autocomplete & { queries: Record<string, unknown>[] } {
    const queries: Record<string, unknown>[] = [];
    const autocomplete = new Autocomplete({ send: msg => queries.push(JSON.parse(msg)) });
    onSheetTeardown(() => autocomplete.destroy());
    return Object.assign(autocomplete, { queries });
}

/** Shows `result` under the autocomplete field `input` and picks it with the mouse. */
export function pickSuggestion(autocomplete: Autocomplete, input: HTMLInputElement, result: AutocompleteResult): void {
    act(() => autocomplete.show(input, [result]));
    const option = input.nextElementSibling!.querySelector(".autocomplete-option")!;
    act(() => {
        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
}

/**
 * The context of a test sheet: sheet "1" with the state of the test, editable,
 * with recording actions; its rolls go with testScope. testSheet() returns it
 * until the next one.
 */
export function sheetEnv(overrides: Partial<SheetEnv> = {}): SheetEnv {
    const state = overrides.state ?? testState();
    return lastEnv = {
        sheetId: "1",
        state,
        ui: new SheetUiState(),
        freeze: new DragFreeze(),
        canEdit: true,
        rollDefaults: { rangedAttack: {}, meleeAttack: {}, psychicPower: {}, techPower: {} } as RollDefaults,
        stats: BLACK_CRUSADE_STATS,
        actions: recordingActions(state),
        rolls: createSheetRolls("1", state, testScope),
        autocomplete: null,
        ...overrides,
    };
}

/**
 * The sheet of the test: the context sheetEnv made last, or the test state
 * with UI state and frozen grids of its own when none was made for it.
 */
export function testSheet(): SheetEnv {
    const state = testState();
    if (lastEnv?.state !== state) lastEnv = sheetEnv({ state });
    return lastEnv;
}

/** A remote change of the sheet of the test, as network.ts applies it. */
export const applyRemote = (msg: RemoteSheetMessage) => applyRemoteToState(testSheet(), msg);

export interface Rendered {
    container: HTMLElement;
    env: SheetEnv;
    unmount(): void;
}

export function renderBlock(
    block: VNode,
    { path = "", ...overrides }: { path?: string } & Partial<SheetEnv> = {},
): Rendered {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const env = sheetEnv(overrides);
    // A real element carries the path, so getDataPath agrees with the context.
    render(
        <SheetContext.Provider value={env}>
            {path ? <Scope dataId={path}>{block}</Scope> : block}
        </SheetContext.Provider>,
        container,
    );
    return {
        container,
        env,
        unmount() {
            render(null, container);
            container.remove();
        },
    };
}

/**
 * The dice and label of a roll event of the sheet, without what signs it and
 * brings its answer back (room/remote.test.ts checks those).
 */
export function rollOf(detail: { [key: string]: unknown }): { [key: string]: unknown } {
    const { requestId: _, sheetID: __, characterName: ___, ...roll } = detail;
    return roll;
}

/** Waits for Preact to run scheduled renders and effects. */
export const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * The path of an element's data-ids, outer to inner. Fields keep data-ids
 * nested like their state paths, and tests and e2e find fields by them.
 */
export function getDataPath(el: Element): string {
    const parts: string[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
        const id = (node as HTMLElement).dataset?.id;
        if (id) parts.unshift(id);
    }
    return Array.from(new Set(parts)).join(".");
}
