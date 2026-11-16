// The Players tab: who is in the room. The gamemaster invites, kicks and
// changes roles here.
import { t } from "../../i18n";
import { me, players } from "../state";
import { changePlayerRole, kickPlayer, openInviteModal } from "../actions";
import { isGamemaster } from "../permissions";
import { humanDate } from "../time_format";
import type { RoomRole } from "../messages";

// The role is stored in English and translated when shown.
// i18n-keys: common.role.*

export function Players() {
    const [mine, ...others] = players.value;
    const gamemaster = isGamemaster(me.value.role);
    return (
        <div class="scroll-container">
            {gamemaster && (
                <button onClick={openInviteModal} class="button-wide button-large button-colored" type="button">
                    {t("room.players.createInvite")}
                </button>
            )}

            {mine && (
                <div class="player" id="current-player" data-user-id={mine.id}>
                    <div class="player-name">{mine.name}</div>
                    <div class="meta role">{t(`common.role.${mine.role}`)}</div>
                    <div class="meta created">{t("room.players.joinedAt", { date: humanDate(mine.joinedAt) })}</div>
                </div>
            )}

            {others.map(player => (
                <div key={player.id} class="player" data-user-id={player.id}>
                    <div class="player-name">{player.name}</div>
                    {gamemaster ? (
                        <select value={player.role} class="role-select" title={t("room.players.role")}
                            onChange={e => changePlayerRole(player.id, e.currentTarget.value as RoomRole)}>
                            <option value="player">{t("common.role.player")}</option>
                            <option value="moderator">{t("common.role.moderator")}</option>
                        </select>
                    ) : (
                        <div class="meta role">{t(`common.role.${player.role}`)}</div>
                    )}
                    <div class="meta created">{t("room.players.joinedAt", { date: humanDate(player.joinedAt) })}</div>
                    {gamemaster && (
                        <div class="control-buttons">
                            <button onClick={() => kickPlayer(player.id)} class="delete-entry" type="button" title={t("room.players.kick")}></button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
