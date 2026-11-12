import { computed, signal } from "@preact/signals-core";

/** Whether the room's socket is open; network.ts keeps it. */
export const online = signal(true);

/**
 * Whether the server runs a newer bundle than the page's (its hello, in
 * network.ts): an old sheet may send what the new server reads otherwise.
 */
export const outdated = signal(false);

/**
 * Whether the sheet may send edits. Without the socket they would be lost,
 * so the sheet is read-only while it is false (useSheet).
 */
export const writable = computed(() => online.value && !outdated.value);
