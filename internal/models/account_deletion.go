package models

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/forum"
	"github.com/jackc/pgx/v5"
)

// WipedAccount is what the wipe of an account leaves for what follows its commit: the email to
// tell, in the user's language, the rooms whose open pages to update and the export file to delete.
type WipedAccount struct {
	// As they were before the wipe.
	Email, Name, Locale string
	// The rooms that stay, of those the user was in, had sheets or chat messages in.
	Rooms []WipedRoom
	// The file of the user's data export, "" for none: the row is gone, the caller deletes the
	// file after the commit.
	ExportFile string
}

// WipedRoom is a room that stays after the wipe of a user of it.
type WipedRoom struct {
	RoomID int
	// Who got the user's sheets, folders and NPCs of the room, and the room if it was the user's;
	// 0 in a room where the user had only chat messages.
	HeirID int
	// Who became a gamemaster of the room by the wipe, 0 for nobody.
	PromotedID int
	// The user's chat messages in the room were deleted.
	MessagesDeleted bool
}

// Wipe carries out the scheduled deletion of the account (plan _prd/account_deletion, sections 3
// and 4) in one transaction: the rooms and what the user had in rooms of others go to their
// gamemasters or with the rooms, the rest of the user's data goes, and the users row stays as a
// tombstone. The choices are those of the account_deletions row, which stays with wiped_at set.
// ErrNoRecord when there is no deletion to carry out: none scheduled, cancelled or done already.
func (m *UserModel) Wipe(ctx context.Context, userID int) (*WipedAccount, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// The deletion row first, then the user, as the cancellation locks them: a cancellation
	// waits for the wipe and finds the row wiped, a wipe after a cancellation finds no row.
	var chat, posts, publicCollections bool
	var heirs map[string]int
	err = tx.QueryRow(ctx, `
SELECT delete_chat_messages, wipe_forum_posts, delete_public_collections, heirs
FROM account_deletions
WHERE user_id = $1 AND wiped_at IS NULL
FOR UPDATE`, userID).Scan(&chat, &posts, &publicCollections, &heirs)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	w := &WipedAccount{}
	var locale *string
	if err := tx.QueryRow(ctx, `SELECT email, name, locale FROM users WHERE id = $1 FOR UPDATE`, userID).
		Scan(&w.Email, &w.Name, &locale); err != nil {
		return nil, err
	}
	if locale != nil {
		w.Locale = *locale
	}

	if w.Rooms, err = wipeRooms(ctx, tx, userID, heirs, chat); err != nil {
		return nil, err
	}
	if err := wipeCollections(ctx, tx, userID, publicCollections); err != nil {
		return nil, err
	}
	if err := forum.WipeUser(ctx, tx, userID, posts, time.Now()); err != nil {
		return nil, err
	}
	// The rows of tables whose key cascades on a real DELETE of the user.
	for _, table := range []string{"room_members", "dice_presets", "tokens", "user_avatars", "user_avatar_locks", "user_name_history"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE user_id = $1`, userID); err != nil {
			return nil, err
		}
	}
	var file *string
	err = tx.QueryRow(ctx, `DELETE FROM data_exports WHERE user_id = $1 RETURNING file_name`, userID).Scan(&file)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if file != nil {
		w.ExportFile = *file
	}

	// hashed_password is no bcrypt hash: every comparison with it fails.
	if _, err := tx.Exec(ctx, `
UPDATE users
SET status = 'deleted', deleted_at = now(), name = '', email = 'deleted-' || id,
    hashed_password = repeat('!', 60), locale = NULL
WHERE id = $1`, userID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE account_deletions SET wiped_at = now() WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	return w, tx.Commit(ctx)
}

// wipeRooms hands on, or deletes with the rooms, the rooms of the user and what they had in the
// rooms of others (plan, sections 4.1 and 4.2), and deletes their chat messages if they chose to.
// Updating owner_id leaves updated_at and the version of a sheet alone: it is no edit of a player,
// and the heir may go over their quota with the NPCs (decision 22).
func wipeRooms(ctx context.Context, tx pgx.Tx, userID int, heirs map[string]int, chat bool) ([]WipedRoom, error) {
	// The rooms are locked in the order of their ids: two wipes of members of one room do not
	// both hand it to each other, and nobody joins it meanwhile.
	rows, err := tx.Query(ctx, `
SELECT r.id, r.owner_id, EXISTS (SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = $1)
FROM rooms r
WHERE r.id IN (
    SELECT room_id FROM room_members WHERE user_id = $1
    UNION SELECT id FROM rooms WHERE owner_id = $1
    UNION SELECT room_id FROM character_sheets WHERE owner_id = $1 AND room_id IS NOT NULL
    UNION SELECT e.room_id FROM character_sheets cs JOIN encounters e ON e.id = cs.encounter_id WHERE cs.owner_id = $1
    UNION SELECT room_id FROM character_sheet_folders WHERE owner_id = $1
)
ORDER BY r.id
FOR UPDATE OF r`, userID)
	if err != nil {
		return nil, err
	}
	type room struct {
		id, ownerID int
		member      bool
	}
	var rs []room
	var r room
	if _, err := pgx.ForEachRow(rows, []any{&r.id, &r.ownerID, &r.member}, func() error {
		rs = append(rs, r)
		return nil
	}); err != nil {
		return nil, err
	}

	rooms := RoomModel{}
	var wiped []WipedRoom
	for _, r := range rs {
		heir, gamemaster, err := chiefGamemaster(ctx, tx, r.id, userID)
		if errors.Is(err, ErrNoRecord) {
			// Nobody else is in the room. One the user was alone in or made and left goes whole,
			// with the sheets of its former members (decisions 19, 20); in a room of another the
			// user was removed from only what is theirs goes.
			if r.member || r.ownerID == userID {
				_, err = tx.Exec(ctx, `DELETE FROM rooms WHERE id = $1`, r.id)
			} else {
				err = deleteFromRoom(ctx, tx, userID, r.id)
			}
			if err != nil {
				return nil, err
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		w := WipedRoom{RoomID: r.id}
		if r.ownerID == userID {
			if chosen, ok := heirs[strconv.Itoa(r.id)]; ok && chosen != userID {
				// The heir the user chose, unless they have left the room since.
				var member bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2)`,
					r.id, chosen).Scan(&member); err != nil {
					return nil, err
				}
				if member {
					heir = chosen
				}
			}
			promoted, err := rooms.Transfer(ctx, tx, r.id, heir)
			if err != nil {
				return nil, err
			}
			if promoted {
				w.PromotedID = heir
			}
		} else if !gamemaster {
			if _, err := tx.Exec(ctx, `UPDATE room_members SET role = 'gamemaster' WHERE room_id = $1 AND user_id = $2`,
				r.id, heir); err != nil {
				return nil, err
			}
			w.PromotedID = heir
		}
		w.HeirID = heir
		// The folders go along with the sheets: a sheet out of its folder would lose the folder's
		// visibility, and a hidden one would show.
		if _, err := tx.Exec(ctx, `
UPDATE character_sheets SET owner_id = $3
WHERE owner_id = $1 AND (room_id = $2 OR encounter_id IN (SELECT id FROM encounters WHERE room_id = $2))`,
			userID, r.id, heir); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE character_sheet_folders SET owner_id = $3 WHERE owner_id = $1 AND room_id = $2`,
			userID, r.id, heir); err != nil {
			return nil, err
		}
		wiped = append(wiped, w)
	}

	if chat {
		rows, err := tx.Query(ctx, `
WITH deleted AS (DELETE FROM room_messages WHERE user_id = $1 RETURNING room_id)
SELECT DISTINCT room_id FROM deleted`, userID)
		if err != nil {
			return nil, err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[int])
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			i := slices.IndexFunc(wiped, func(w WipedRoom) bool { return w.RoomID == id })
			if i < 0 {
				wiped = append(wiped, WipedRoom{RoomID: id})
				i = len(wiped) - 1
			}
			wiped[i].MessagesDeleted = true
		}
	}
	slices.SortFunc(wiped, func(a, b WipedRoom) int { return a.RoomID - b.RoomID })
	return wiped, nil
}

// deleteFromRoom deletes the sheets, NPCs and folders of the user in the room.
func deleteFromRoom(ctx context.Context, tx pgx.Tx, userID, roomID int) error {
	if _, err := tx.Exec(ctx, `
DELETE FROM character_sheets
WHERE owner_id = $1 AND (room_id = $2 OR encounter_id IN (SELECT id FROM encounters WHERE room_id = $2))`,
		userID, roomID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM character_sheet_folders WHERE owner_id = $1 AND room_id = $2`, userID, roomID)
	return err
}

// wipeCollections deletes the user's private collections, and the public ones nobody else is
// subscribed to or, with all, every public one; a public collection that stays keeps its creatures
// and loses the name of its author (decision 13). The author_id of the creatures and NPCs made from
// the user's goes too, as a real DELETE of the user would set it (000039); their source_label
// stays (decision 26).
func wipeCollections(ctx context.Context, tx pgx.Tx, userID int, all bool) error {
	if _, err := tx.Exec(ctx, `
DELETE FROM bestiary_collections c
WHERE c.owner_id = $1
  AND (c.visibility = 'private' OR $2
       OR NOT EXISTS (SELECT 1 FROM bestiary_subscriptions s WHERE s.collection_id = c.id AND s.user_id <> $1))`,
		userID, all); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM bestiary_subscriptions WHERE user_id = $1`, userID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE character_sheets SET author_id = NULL WHERE author_id = $1`, userID)
	return err
}
