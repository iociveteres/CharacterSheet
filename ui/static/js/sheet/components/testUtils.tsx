// Helpers for component tests: a sheet state and a rendered block without
// network.js, which connects a WebSocket on import.
import { render, type VNode } from "preact";
import { normalizeSheet } from "../schema/normalize";
import { jsonToSignals } from "../state/fromJson";
import { characterState } from "../state/state.js";
import { createSheetActions, type SheetActions } from "../state/actions";
import { SheetContext, type AutocompleteService, type SheetEnv } from "./context";
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

export interface Rendered {
    container: HTMLElement;
    env: SheetEnv;
    unmount(): void;
}

export function renderBlock(
    block: VNode,
    { canEdit = true, path = "", actions = recordingActions(), autocomplete = null }:
        { canEdit?: boolean; path?: string; actions?: SheetActions; autocomplete?: AutocompleteService | null } = {},
): Rendered {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const env: SheetEnv = { canEdit, actions, autocomplete };
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
