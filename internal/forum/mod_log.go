package forum

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgx/v5"
)

const (
	modLogURL         = "/forum/mod/log"
	logEntriesPerPage = 50
)

// logLine is a row of the moderation log as its page shows it: the targets by name as they are
// now, what they no longer show from data.
type logLine struct {
	ID            int
	Action        modAction
	At            time.Time
	ModeratorID   int
	ModeratorName string
	Reason        string
	TopicID       int
	TopicTitle    string
	TopicDeleted  bool
	PostID        int
	SectionID     int
	SectionName   string
	UserID        int
	UserName      string
	// Was is the title before a rename, the name of a section before an edit that changed it.
	Was string
	// FromSection is the section a moved topic left.
	FromSection string
	// From and To are the places of a moved section, from 1.
	From, To int
	// Banned is whether the line gives a ban; ExpiresAt is its end, nil until lifted.
	Banned    bool
	ExpiresAt *time.Time
	// Lock is the term of the lock on a new avatar a removal gave: none, 7, 30 or forever (lockTerms);
	// LockUntil is its end. Empty for other actions.
	Lock      string
	LockUntil *time.Time
	// Count is how many posts a deletion of the author's last day took, or its restoration gave back.
	Count int
	// Restorable is how many of the posts of a deletion of the last day are still deleted by it
	// (restorableSQL): «Restore all» shows while there are some.
	Restorable int
	// ParentMoved: an edit of a section moved it to another parent, from FromParent to ToParent;
	// a name is empty for the top level.
	ParentMoved          bool
	FromParent, ToParent string
}

// ActionText words the code of the line in the reader's language; a code this build does not know
// reads as itself.
func (l logLine) ActionText(lang string) string {
	switch l.Action {
	case actionRenameTopic:
		return i18n.T(lang, "forum.moderation.action.topicRename")
	case actionPinTopic:
		return i18n.T(lang, "forum.moderation.action.topicPin")
	case actionUnpinTopic:
		return i18n.T(lang, "forum.moderation.action.topicUnpin")
	case actionCloseTopic:
		return i18n.T(lang, "forum.moderation.action.topicClose")
	case actionOpenTopic:
		return i18n.T(lang, "forum.moderation.action.topicOpen")
	case actionMoveTopic:
		return i18n.T(lang, "forum.moderation.action.topicMove")
	case actionDeleteTopic:
		return i18n.T(lang, "forum.moderation.action.topicDelete")
	case actionRestoreTopic:
		return i18n.T(lang, "forum.moderation.action.topicRestore")
	case actionDeletePost:
		return i18n.T(lang, "forum.moderation.action.postDelete")
	case actionRestorePost:
		return i18n.T(lang, "forum.moderation.action.postRestore")
	case actionDeleteRecent:
		return i18n.T(lang, "forum.moderation.action.postDeleteRecent", i18n.Params{"count": l.Count})
	case actionRestoreRecent:
		return i18n.T(lang, "forum.moderation.action.postRestoreRecent", i18n.Params{"count": l.Count})
	case actionCreateSection:
		return i18n.T(lang, "forum.moderation.action.sectionCreate")
	case actionEditSection:
		return i18n.T(lang, "forum.moderation.action.sectionEdit")
	case actionMoveSection:
		return i18n.T(lang, "forum.moderation.action.sectionMove")
	case actionBanUser:
		return i18n.T(lang, "forum.moderation.action.userBan")
	case actionUnbanUser:
		return i18n.T(lang, "forum.moderation.action.userUnban")
	case actionRemoveAvatar:
		return i18n.T(lang, "forum.moderation.action.avatarRemove")
	case actionUnlockAvatar:
		return i18n.T(lang, "forum.moderation.action.avatarUnlock")
	case actionEraseAbout:
		return i18n.T(lang, "forum.moderation.action.aboutErase")
	}
	return string(l.Action)
}

type modLogData struct {
	view
	Lines      []logLine
	Pagination pagination
	// User is the user the log is filtered by (?user=), nil for the whole log.
	User *logUser
	// Back is the address of this page, where «Restore all» comes back to.
	Back string
}

type logUser struct {
	ID   int
	Name string
}

// modLogPage is the moderation log, the newest action first, for moderators only; ?user=N keeps the
// actions on one user (their page links it). A target links to where it is, deleted or not: a
// moderator reads a deleted topic and post.
func (f *Forum) modLogPage(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	page, ok := pageParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	data := modLogData{view: v, Back: r.URL.RequestURI()}
	path, userID := modLogURL, 0
	if q := r.URL.Query(); q.Has("user") {
		id, err := strconv.Atoi(q.Get("user"))
		if err != nil || id < 1 {
			f.host.NotFound(w, r)
			return
		}
		data.User = &logUser{ID: id}
		err = f.db.QueryRow(r.Context(), `SELECT name FROM users WHERE id = $1`, id).Scan(&data.User.Name)
		if errors.Is(err, pgx.ErrNoRows) {
			f.host.NotFound(w, r)
			return
		}
		if err != nil {
			f.host.ServerError(w, r, err)
			return
		}
		path, userID = modLogURL+"?user="+strconv.Itoa(id), id
	}
	var total int
	err := f.db.QueryRow(r.Context(), `SELECT count(*) FROM forum_mod_log WHERE $1 = 0 OR user_id = $1`, userID).Scan(&total)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	pages := pageCount(total, logEntriesPerPage)
	if page > pages {
		f.host.NotFound(w, r)
		return
	}
	data.Lines, err = f.logLines(r.Context(), userID, logEntriesPerPage, (page-1)*logEntriesPerPage)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data.Pagination = pagination{Lang: v.Lang, Path: path, Current: page, Total: pages}
	title := i18n.T(v.Lang, "forum.moderation.log")
	if data.User != nil {
		title += ": " + data.User.Name
	}
	f.render(w, r, http.StatusOK, "mod_log.html", data, Page{Title: title, NoIndex: true})
}

// logLines reads lines of the log, the newest first: all of them, or those on the user userID.
func (f *Forum) logLines(ctx context.Context, userID, limit, offset int) ([]logLine, error) {
	// The values of data are read under CASE by action: another action may keep the same key as
	// something else.
	rows, err := f.db.Query(ctx, `
		SELECT l.id, l.action, l.created_at, l.moderator_id, m.name, l.reason,
		       COALESCE(l.topic_id, 0), COALESCE(t.title, ''), t.deleted_at IS NOT NULL,
		       COALESCE(l.post_id, 0),
		       COALESCE(l.section_id, 0), COALESCE(s.name, ''),
		       COALESCE(l.user_id, 0), COALESCE(u.name, ''),
		       COALESCE(CASE l.action
		           WHEN 'topic.rename' THEN l.data->>'title'
		           WHEN 'section.edit' THEN NULLIF(l.data->>'name', s.name)
		       END, ''),
		       COALESCE(fs.name, ''),
		       COALESCE(CASE WHEN l.action = 'section.move' THEN (l.data->>'from')::int END, 0),
		       COALESCE(CASE WHEN l.action = 'section.move' THEN (l.data->>'to')::int END, 0),
		       l.action = 'user.ban',
		       CASE WHEN l.action = 'user.ban' THEN (l.data->>'expiresAt')::timestamptz END,
		       COALESCE(CASE WHEN l.action = 'avatar.remove' THEN l.data->>'lock' END, ''),
		       CASE WHEN l.action = 'avatar.remove' THEN (l.data->>'lockUntil')::timestamptz END,
		       COALESCE(CASE WHEN l.action IN ('post.delete_recent', 'post.restore_recent') THEN jsonb_array_length(l.data->'posts') END, 0),
		       CASE WHEN l.action = 'post.delete_recent' THEN (SELECT count(*) FROM forum_posts q WHERE `+restorableSQL+`) ELSE 0 END,
		       l.action = 'section.edit' AND l.data ? 'parent', COALESCE(fp.name, ''), COALESCE(tp.name, '')
		FROM forum_mod_log l
		JOIN users m ON m.id = l.moderator_id
		LEFT JOIN forum_topics t ON t.id = l.topic_id
		LEFT JOIN forum_sections s ON s.id = l.section_id
		LEFT JOIN users u ON u.id = l.user_id
		LEFT JOIN forum_sections fs ON fs.id = CASE WHEN l.action = 'topic.move' THEN (l.data->>'fromSection')::int END
		LEFT JOIN forum_sections fp ON fp.id = CASE WHEN l.action = 'section.edit' THEN (l.data->>'parent')::int END
		LEFT JOIN forum_sections tp ON tp.id = CASE WHEN l.action = 'section.edit' THEN (l.data->>'parentTo')::int END
		WHERE $3 = 0 OR l.user_id = $3
		ORDER BY l.id DESC
		LIMIT $1 OFFSET $2`, limit, offset, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[logLine])
}
