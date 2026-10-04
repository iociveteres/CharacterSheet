// The WebSocket of the room page (../socket.ts): the room (room/remote.ts)
// and the sheet (sheet/network.ts) listen to the ws:<type> events.
import { connectSocket } from '../socket';

const roomId = document.getElementById('room')?.dataset.roomId;
if (roomId) connectSocket(`/room/ws/${roomId}`);
else console.error('Room ID not found');
