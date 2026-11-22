// The WebSocket of the room page (../socket.ts): the room (room/remote.ts)
// and the sheet (sheet/network.ts) listen to the ws:<type> events.
import { connectSocket } from '../socket';

const roomId = document.getElementById('room')?.dataset.roomId;
// The room's state answers 404 once the user is no longer in the room.
if (roomId) connectSocket(`/room/ws/${roomId}`, `/room/state/${roomId}`);
else console.error('Room ID not found');
