// The file of an encounter over HTTP (internal/webapp/encounters.go): its
// NPCs exported, files loaded as new encounters, and a file's NPCs in place
// of those of an encounter. Errors are the bestiary's ApiError.
import { request } from "../../bestiary/api";
import type { EncounterLoadResult, EncounterState } from "./types.gen";

export const exportUrl = (id: number) => `/encounter/${id}/export`;

/** Makes a new encounter of each file; the server stops at the first over the quota. */
export function loadFiles(roomId: number, files: File[]): Promise<EncounterLoadResult[]> {
    const form = new FormData();
    form.append("room_id", String(roomId));
    for (const file of files) form.append("files", file);
    return request<EncounterLoadResult[]>("POST", "/encounters/load", form);
}

export function replaceNpcs(encounterId: number, file: File): Promise<EncounterState> {
    const form = new FormData();
    form.append("file", file);
    return request<EncounterState>("POST", `/encounter/${encounterId}/npcs`, form);
}
