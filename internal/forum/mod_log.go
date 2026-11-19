package forum

import (
	"net/http"
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
	}
	return string(l.Action)
}

type modLogData struct {
	view
	Lines      []logLine
	Pagination pagination
}

// modLogPage is the moderation log, the newest action first, for moderators only. A target links
// to where it is, deleted or not: a moderator reads a deleted topic and post.
func (f *Forum) modLogPage(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	page, ok := pageParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	var total int
	if err := f.db.QueryRow(r.Context(), `SELECT count(*) FROM forum_mod_log`).Scan(&total); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	pages := pageCount(total, logEntriesPerPage)
	if page > pages {
		f.host.NotFound(w, r)
		return
	}
	// The values of data are read under CASE by action: another action may keep the same key as
	// something else.
	rows, err := f.db.Query(r.Context(), `
		SELECT l.id, l.action, l.created_at, m.name, l.reason,
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
		       CASE WHEN l.action = 'user.ban' THEN (l.data->>'expiresAt')::timestamptz END
		FROM forum_mod_log l
		JOIN users m ON m.id = l.moderator_id
		LEFT JOIN forum_topics t ON t.id = l.topic_id
		LEFT JOIN forum_sections s ON s.id = l.section_id
		LEFT JOIN users u ON u.id = l.user_id
		LEFT JOIN forum_sections fs ON fs.id = CASE WHEN l.action = 'topic.move' THEN (l.data->>'fromSection')::int END
		ORDER BY l.id DESC
		LIMIT $1 OFFSET $2`, logEntriesPerPage, (page-1)*logEntriesPerPage)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	lines, err := pgx.CollectRows(rows, pgx.RowToStructByPos[logLine])
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := modLogData{
		view:       v,
		Lines:      lines,
		Pagination: pagination{Lang: v.Lang, Path: modLogURL, Current: page, Total: pages},
	}
	f.render(w, r, http.StatusOK, "mod_log.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.moderation.log"),
		NoIndex: true,
	})
}
