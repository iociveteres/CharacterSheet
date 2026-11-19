package forum

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// modAction is the code of a moderator action in forum_mod_log.action. Codes are stored: never
// rename one, the log page words old rows by it.
type modAction string

const (
	actionRenameTopic   modAction = "topic.rename"
	actionPinTopic      modAction = "topic.pin"
	actionUnpinTopic    modAction = "topic.unpin"
	actionCloseTopic    modAction = "topic.close"
	actionOpenTopic     modAction = "topic.open"
	actionMoveTopic     modAction = "topic.move"
	actionDeleteTopic   modAction = "topic.delete"
	actionRestoreTopic  modAction = "topic.restore"
	actionDeletePost    modAction = "post.delete"
	actionRestorePost   modAction = "post.restore"
	actionCreateSection modAction = "section.create"
	actionEditSection   modAction = "section.edit"
	actionMoveSection   modAction = "section.move"
	actionBanUser       modAction = "user.ban"
	actionUnbanUser     modAction = "user.unban"
)

// modEntry is a row of forum_mod_log: what a moderator did, to what, why. A target is 0 when the
// action has none of that kind.
type modEntry struct {
	Action    modAction
	TopicID   int
	PostID    int
	SectionID int
	UserID    int
	// Reason is the moderator's own words, never translated; may be empty.
	Reason string
	// Data is what the targets no longer show once changed: the title before a rename, the section
	// a topic left.
	Data map[string]any

	// Set by moderate.
	ID          int
	ModeratorID int
	At          time.Time
}

// modChange makes the change of one action in the transaction of moderate. It may fill in what it
// learns on the way (Data, a topic of a post). errNoChange: the target is already so.
type modChange func(ctx context.Context, tx pgx.Tx, e *modEntry) error

// errNoChange is a change that found its target already as asked (a pinned topic pinned again, a
// form sent twice): nothing is written, not even the log.
var errNoChange = errors.New("forum: nothing to change")

var errNotModerator = errors.New("forum: not a moderator")

// moderate is the one way of every moderator action: the change, its line in the log and the
// notification of whom it concerns (notifyOfModeration), in one transaction. A new action is a
// modAction and a modChange; this function stays as it is. The handler has asked rights.go already; moderate only
// refuses a viewer who is not a moderator at all.
func (f *Forum) moderate(ctx context.Context, by Viewer, at time.Time, e modEntry, change modChange) error {
	if !by.Moderator {
		return errNotModerator
	}
	e.ModeratorID, e.At = by.ID, at
	if e.Data == nil {
		e.Data = map[string]any{}
	}
	err := pgx.BeginFunc(ctx, f.db, func(tx pgx.Tx) error {
		if err := change(ctx, tx, &e); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO forum_mod_log (moderator_id, action, topic_id, post_id, section_id, user_id, reason, data, created_at)
			VALUES ($1, $2, NULLIF($3, 0), NULLIF($4, 0), NULLIF($5, 0), NULLIF($6, 0), $7, $8, $9)
			RETURNING id`,
			e.ModeratorID, string(e.Action), e.TopicID, e.PostID, e.SectionID, e.UserID, e.Reason, e.Data, e.At).
			Scan(&e.ID)
		if err != nil {
			return err
		}
		return notifyOfModeration(ctx, tx, e)
	})
	if errors.Is(err, errNoChange) {
		return nil
	}
	return err
}
