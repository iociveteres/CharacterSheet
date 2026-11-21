package models

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	// DeletionGrace is the time between scheduling the deletion and the wipe, in which it can be
	// cancelled (plan _prd/account_deletion, decision 6).
	DeletionGrace = 3 * 24 * time.Hour
	// ReminderWait is how long after delete_at the wipe waits for the reminder to go out (decision
	// 21); a cancel link holds until then.
	ReminderWait = 7 * 24 * time.Hour
)

// DeletionSummary is what the deletion page tells the user will become of what is theirs (plan,
// section 5.1, step 2).
type DeletionSummary struct {
	Name string
	// The rooms nobody else is in, which go with the account.
	LoneRooms []NamedRoom
	// The sheets of former members of the lone rooms, which go with them (decision 19).
	FormerMembersSheets int
	// The user's rooms with other people, each with its heir to pick.
	OwnedRooms []OwnedRoom
	// The user's sheets and NPCs in rooms with other people, which go to their gamemasters.
	HandedSheets int
	// The collections that go: the private ones, and the public ones nobody else is subscribed to.
	DeletedCollections []string
	// The public collections others are subscribed to: they stay without the author's name, unless
	// the user deletes them too.
	KeptCollections []KeptCollection
	ChatMessages    int
	ForumPosts      int
	// The user moderates the forum: the page warns that this goes.
	Moderator bool
}

type NamedRoom struct {
	ID   int
	Name string
}

// OwnedRoom is a room the user made and shares with others: it goes to the heir the user picks.
type OwnedRoom struct {
	NamedRoom
	// The other members, in the order they joined.
	Members []RoomHeir
	// The heir picked by default: the earliest gamemaster, else the earliest member (section 4.2).
	DefaultHeir int
}

type RoomHeir struct {
	ID   int
	Name string
}

type KeptCollection struct {
	Name        string
	Subscribers int
}

// DeletionChoices are the boxes and heirs of the deletion page, applied at the wipe.
type DeletionChoices struct {
	ChatMessages, ForumPosts, PublicCollections bool
	// Heirs maps a room of the user to the member who gets it.
	Heirs map[int]int
}

// ScheduledDeletion is a deletion just scheduled: when the wipe comes and the cancel link's token.
type ScheduledDeletion struct {
	DeleteAt    time.Time
	CancelToken string
}

// DeletionSummary counts what the deletion of the account does, as Wipe would do it now.
func (m *UserModel) DeletionSummary(ctx context.Context, userID int) (*DeletionSummary, error) {
	s := &DeletionSummary{}
	err := m.DB.QueryRow(ctx, `
SELECT u.name,
       (SELECT count(*) FROM room_messages WHERE user_id = u.id),
       (SELECT count(*) FROM forum_posts WHERE author_id = u.id AND deleted_at IS NULL),
       EXISTS (SELECT 1 FROM forum_moderators WHERE user_id = u.id)
FROM users u
WHERE u.id = $1 AND u.status = 'email_verified'`, userID).Scan(&s.Name, &s.ChatMessages, &s.ForumPosts, &s.Moderator)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}

	// A room goes whole when nobody else is in it and the user is in it or made it (wipeRooms).
	rows, err := m.DB.Query(ctx, `
SELECT r.id, r.name
FROM rooms r
WHERE (r.owner_id = $1 OR EXISTS (SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = $1))
  AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_id = r.id AND user_id <> $1)
ORDER BY r.id`, userID)
	if err != nil {
		return nil, err
	}
	if s.LoneRooms, err = pgx.CollectRows(rows, pgx.RowToStructByPos[NamedRoom]); err != nil {
		return nil, err
	}
	lone := make([]int, len(s.LoneRooms))
	for i, r := range s.LoneRooms {
		lone[i] = r.ID
	}
	err = m.DB.QueryRow(ctx, `
SELECT
  (SELECT count(*) FROM character_sheets cs
   WHERE cs.owner_id <> $1
     AND (cs.room_id = ANY($2) OR cs.encounter_id IN (SELECT id FROM encounters WHERE room_id = ANY($2)))),
  (SELECT count(*) FROM character_sheets cs
   LEFT JOIN encounters e ON e.id = cs.encounter_id
   WHERE cs.owner_id = $1
     AND EXISTS (SELECT 1 FROM room_members WHERE room_id = COALESCE(cs.room_id, e.room_id) AND user_id <> $1))`,
		userID, lone).Scan(&s.FormerMembersSheets, &s.HandedSheets)
	if err != nil {
		return nil, err
	}

	rows, err = m.DB.Query(ctx, `
SELECT r.id, r.name, rm.user_id, u.name, rm.role = 'gamemaster'
FROM rooms r
JOIN room_members rm ON rm.room_id = r.id AND rm.user_id <> $1
JOIN users u ON u.id = rm.user_id
WHERE r.owner_id = $1
  AND EXISTS (SELECT 1 FROM room_members WHERE room_id = r.id AND user_id = $1)
ORDER BY r.id, rm.joined_at, rm.user_id`, userID)
	if err != nil {
		return nil, err
	}
	var roomID, heirID int
	var roomName, heirName string
	var gamemaster bool
	defaultIsGamemaster := false
	if _, err := pgx.ForEachRow(rows, []any{&roomID, &roomName, &heirID, &heirName, &gamemaster}, func() error {
		n := len(s.OwnedRooms)
		if n == 0 || s.OwnedRooms[n-1].ID != roomID {
			s.OwnedRooms = append(s.OwnedRooms, OwnedRoom{NamedRoom: NamedRoom{roomID, roomName}, DefaultHeir: heirID})
			n++
			defaultIsGamemaster = gamemaster
		}
		r := &s.OwnedRooms[n-1]
		r.Members = append(r.Members, RoomHeir{heirID, heirName})
		if gamemaster && !defaultIsGamemaster {
			r.DefaultHeir, defaultIsGamemaster = heirID, true
		}
		return nil
	}); err != nil {
		return nil, err
	}

	rows, err = m.DB.Query(ctx, `
SELECT c.name, count(s.user_id)::int, c.visibility = 'private'
FROM bestiary_collections c
LEFT JOIN bestiary_subscriptions s ON s.collection_id = c.id AND s.user_id <> $1
WHERE c.owner_id = $1
GROUP BY c.id
ORDER BY c.is_default DESC, c.name, c.id`, userID)
	if err != nil {
		return nil, err
	}
	var name string
	var subscribers int
	var private bool
	if _, err := pgx.ForEachRow(rows, []any{&name, &subscribers, &private}, func() error {
		if private || subscribers == 0 {
			s.DeletedCollections = append(s.DeletedCollections, name)
		} else {
			s.KeptCollections = append(s.KeptCollections, KeptCollection{name, subscribers})
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s, nil
}

// ScheduleDeletion schedules the deletion of a confirmed account by the token of the deletion
// link, in one transaction: the token is used up, the account_deletions row made with the choices
// and the status set to deleting. An heir who is not a member of a room of the user is dropped:
// the wipe picks one by default. It returns the token of a cancel link, good until the wipe
// gives up waiting for the reminder. ErrNoRecord for a token that is not the user's or has
// expired, and for an account not confirmed or already deleting.
func (m *UserModel) ScheduleDeletion(ctx context.Context, userID int, tokenPlaintext string, c DeletionChoices) (*ScheduledDeletion, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	hash := sha256.Sum256([]byte(tokenPlaintext))
	tag, err := tx.Exec(ctx, `DELETE FROM tokens WHERE hash = $1 AND scope = $2 AND user_id = $3 AND expiry > now()`,
		hash[:], ScopeDeleteAccount, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNoRecord
	}

	rooms, heirs := make([]int, 0, len(c.Heirs)), make([]int, 0, len(c.Heirs))
	for room, heir := range c.Heirs {
		rooms, heirs = append(rooms, room), append(heirs, heir)
	}
	var kept map[string]int
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(jsonb_object_agg(h.room_id::text, h.heir_id), '{}')
FROM unnest($2::int[], $3::int[]) AS h(room_id, heir_id)
JOIN rooms r ON r.id = h.room_id AND r.owner_id = $1
JOIN room_members rm ON rm.room_id = h.room_id AND rm.user_id = h.heir_id AND rm.user_id <> $1`,
		userID, rooms, heirs).Scan(&kept); err != nil {
		return nil, err
	}
	heirsJSON, err := json.Marshal(kept)
	if err != nil {
		return nil, err
	}

	d := &ScheduledDeletion{}
	// A row left of a wipe means a tombstone, which has no session to get here; one in its grace
	// period means a second link used meanwhile.
	err = tx.QueryRow(ctx, `
INSERT INTO account_deletions (user_id, delete_at, delete_chat_messages, wipe_forum_posts, delete_public_collections, heirs)
VALUES ($1, now() + make_interval(secs => $2), $3, $4, $5, $6)
ON CONFLICT (user_id) DO NOTHING
RETURNING delete_at`,
		userID, DeletionGrace.Seconds(), c.ChatMessages, c.ForumPosts, c.PublicCollections, heirsJSON).Scan(&d.DeleteAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	tag, err = tx.Exec(ctx, `UPDATE users SET status = 'deleting' WHERE id = $1 AND status = 'email_verified'`, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNoRecord
	}

	token, err := generateToken(userID, time.Until(d.DeleteAt)+ReminderWait, ScopeCancelDeletion)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO tokens (hash, user_id, expiry, scope) VALUES ($1, $2, $3, $4)`,
		token.Hash, token.UserID, token.Expiry, token.Scope); err != nil {
		return nil, err
	}
	d.CancelToken = token.Plaintext
	return d, tx.Commit(ctx)
}

// PendingDeletion is when the scheduled deletion of the account comes; ErrNoRecord when none is
// pending: never scheduled, cancelled or carried out.
func (m *UserModel) PendingDeletion(ctx context.Context, userID int) (time.Time, error) {
	var at time.Time
	err := m.DB.QueryRow(ctx, `SELECT delete_at FROM account_deletions WHERE user_id = $1 AND wiped_at IS NULL`, userID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return at, ErrNoRecord
	}
	return at, err
}

// CancelDeletion cancels the pending deletion of the account in one transaction: the row goes,
// the account is confirmed again and the cancel links stop working. It locks the deletion row,
// then the user, as Wipe does: a cancellation during a wipe waits for its commit and finds the
// row wiped. ErrNoRecord when no deletion is pending.
func (m *UserModel) CancelDeletion(ctx context.Context, userID int) error {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `DELETE FROM account_deletions WHERE user_id = $1 AND wiped_at IS NULL`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoRecord
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET status = 'email_verified' WHERE id = $1 AND status = 'deleting'`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM tokens WHERE user_id = $1 AND scope = $2`, userID, ScopeCancelDeletion); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
