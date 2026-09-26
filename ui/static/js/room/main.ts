// Entry point of the room page bundle: the room, on Alpine until it moves to
// Preact, and the sheet it shows (sheet/main.ts).
import Alpine from "@alpinejs/csp";
import { registerRoom } from "./component.js";
import "../sheet/main";

registerRoom();
Alpine.start();
