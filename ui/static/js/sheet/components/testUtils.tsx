// Helpers for component tests: a sheet state and a rendered block without
// network.js, which connects a WebSocket on import.
import { render, type VNode } from "preact";
import { normalizeSheet } from "../schema/normalize";
import { jsonToSignals } from "../state/fromJson";
import { characterState } from "../state/state.js";
import { createSheetActions, type SheetActions } from "../state/actions";
import { SheetContext, type SheetEnv } from "./context";
import type { RollDefaults } from "../current";
import { Scope } from "./Scope";

/** Replaces the sheet state with the normalized `content`. */
export function loadState(content: unknown): void {
    for (const key of Object.keys(characterState)) delete (characterState as Record<string, unknown>)[key];
    Object.assign(characterState, jsonToSignals(normalizeSheet(content, { onGhost: () => {} })));
}

export interface Sent {
    sent: object[];
    scheduled: [object, string][];
}

/** Real actions that record the messages instead of sending them. */
export function recordingActions(): SheetActions & Sent {
    const log: Sent = { sent: [], scheduled: [] };
    const actions = createSheetActions({
        send: msg => log.sent.push(msg),
        schedule: (msg, key) => log.scheduled.push([msg, key]),
    });
    return Object.assign(actions, log);
}

/** The context of a test sheet: sheet "1", editable, with recording actions. */
export function sheetEnv(overrides: Partial<SheetEnv> = {}): SheetEnv {
    return {
        sheetId: "1",
        canEdit: true,
        rollDefaults: { rangedAttack: {}, meleeAttack: {}, psychicPower: {}, techPower: {} } as RollDefaults,
        actions: recordingActions(),
        autocomplete: null,
        ...overrides,
    };
}

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
