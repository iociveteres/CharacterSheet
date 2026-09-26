// Entry point of the room page bundle: the room, moving from Alpine to Preact
// islands, and the sheet it shows (sheet/main.ts).
import Alpine from "@alpinejs/csp";
import { registerRoom } from "./component.js";
import { initRoomState, readRoomPayload } from "./state";
import { listenRemote } from "./remote";
import { mountIslands } from "./islands";
import "../sheet/main";

const payload = readRoomPayload();
initRoomState(payload);
listenRemote();
mountIslands();

registerRoom(payload);
Alpine.start();
