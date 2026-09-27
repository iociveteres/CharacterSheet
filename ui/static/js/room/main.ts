// Entry point of the room page bundle: the room's Preact islands and the
// sheet it shows (sheet/main.ts).
import "./socket.js";
import { initRoomState, readRoomPayload } from "./state";
import { listenRemote } from "./remote";
import { mountIslands } from "./islands";
import "../sheet/main";

// A panel the player hid does not slide away on load.
document.body.classList.add("no-transitions");

initRoomState(readRoomPayload());
listenRemote();
mountIslands();

// view_room.html keeps the room hidden until the islands are in it.
document.getElementById("room")!.hidden = false;
setTimeout(() => document.body.classList.remove("no-transitions"), 100);
