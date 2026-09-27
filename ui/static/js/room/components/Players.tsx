// The Players tab: who is in the room. The gamemaster invites, kicks and
// changes roles here.
import { me, players } from "../state";
import { changePlayerRole, kickPlayer, openInviteModal } from "../actions";
import { isGamemaster } from "../permissions";
import { humanDate } from "../time_format";
import type { RoomRole } from "../messages";

export function Players() {
    const [mine, ...others] = players.value;
    const gamemaster = isGamemaster(me.value.role);
    return (
        <div class="scroll-container">
            {gamemaster && (
                <button onClick={openInviteModal} class="button-wide button-large button-colored" type="button">
                    Create invite
                </button>
            )}

            {mine && (
                <div class="player" id="current-player" data-user-id={mine.id}>
                    <div class="player-name">{mine.name}</div>
                    <div class="meta role">{mine.role}</div>
                    <div class="meta created">{`Joined at ${humanDate(mine.joinedAt)}`}</div>
                </div>
            )}

            {others.map(player => (
                <div key={player.id} class="player" data-user-id={player.id}>
                    <div class="player-name">{player.name}</div>
                    {gamemaster ? (
                        <select value={player.role} class="role-select" title="Role"
                            onChange={e => changePlayerRole(player.id, e.currentTarget.value as RoomRole)}>
                            <option value="player">Player</option>
                            <option value="moderator">Moderator</option>
                        </select>
                    ) : (
                        <div class="meta role">{player.role}</div>
                    )}
                    <div class="meta created">{`Joined at ${humanDate(player.joinedAt)}`}</div>
                    {gamemaster && (
                        <div class="control-buttons">
                            <button onClick={() => kickPlayer(player.id)} class="delete-entry" type="button" title="Kick player"></button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
