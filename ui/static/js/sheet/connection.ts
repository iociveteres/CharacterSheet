import { signal } from "@preact/signals-core";

/**
 * Whether the room's socket is open; network.js keeps it. Edits made without
 * it would be lost, so the sheet is read-only while it is false (useSheet).
 */
export const online = signal(true);
