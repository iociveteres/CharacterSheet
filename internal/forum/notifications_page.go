package forum

import (
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgx/v5"
)

const (
	notificationsURL     = "/forum/notifications"
	notificationsPerPage = 30
)

// Badge is the counter of unread notifications as the nav of the site and the button of the forum
// home show it (design/decisions.md, 14): empty for none, "9+" past nine.
func Badge(n int) string {
	switch {
	case n <= 0:
		return ""
	case n > 9:
		return "9+"
	}
	return strconv.Itoa(n)
}

// notificationRow is a row of forum_notifications with whether its topic is deleted now.
type notificationRow struct {
	ID      int
	Kind    notificationKind
	TopicID *int
	PostID  *int
	Count   int
	Params  map[string]any
	// At is the last event: the last reply gathered into the row.
	At           time.Time
	Unread       bool
	TopicDeleted *time.Time
}

// moderation is whether the row tells of a moderator's action: it is read once shown on the page,
// not by reading the topic.
func (n notificationRow) moderation() bool {
	return n.Kind != notifyReplies && n.Kind != notifyQuote
}

// notificationLine is a notification as its page shows it (design/decisions.md, 21): the kind and
// the time above, the text, a link when there is somewhere the viewer can go, the moderator's
// reason on its own line.
type notificationLine struct {
	Label  string
	Text   string
	URL    string
	Reason string
	At     time.Time
	Unread bool
}

// line words the row in the reader's language. The text takes the parameters the row keeps, so a
// topic the viewer no longer sees still has its title; it is a link only while the viewer may read
// the topic (CanReadTopic), and leads to the post of the row — for replies, the first unread one.
func (n notificationRow) line(v view, accountURL string) notificationLine {
	params := i18n.Params{}
	for k, value := range n.Params {
		params[k] = value
	}
	key := "forum.notifications.text." + string(n.Kind)
	switch n.Kind {
	case notifyReplies:
		params["count"] = n.Count
	case notificationKind(actionBanUser):
		// expiresAt is null for a ban until lifted.
		end, ok := n.Params["expiresAt"].(string)
		at, err := time.Parse(time.RFC3339, end)
		if ok && err == nil {
			params["date"] = v.Date(at)
		} else {
			key = "forum.notifications.text.user.banForever"
		}
	case notificationKind(actionRestoreRecent):
		// The code has an underscore, the catalog's keys none.
		key = "forum.notifications.text.post.restoreRecent"
	case notificationKind(actionRemoveAvatar):
		// A lock of a term until a date, for good, or none.
		end, _ := n.Params["lockUntil"].(string)
		if at, err := time.Parse(time.RFC3339, end); err == nil {
			params["date"] = v.Date(at)
			key = "forum.notifications.text.avatar.removeUntil"
		} else if n.Params["lock"] == "forever" {
			key = "forum.notifications.text.avatar.removeForever"
		}
	}
	l := notificationLine{Text: i18n.T(v.Lang, key, params), At: n.At, Unread: n.Unread}
	switch n.Kind {
	case notifyReplies:
		l.Label = i18n.T(v.Lang, "forum.topics.replies")
	case notifyQuote:
		l.Label = i18n.T(v.Lang, "forum.notifications.kindQuote")
	default:
		l.Label = i18n.T(v.Lang, "forum.moderation.menu")
	}
	if reason, ok := n.Params["reason"].(string); ok {
		l.Reason = reason
	}
	switch n.Kind {
	case notificationKind(actionRemoveAvatar), notificationKind(actionUnlockAvatar):
		// The avatar is the site's: the page where it changes.
		l.URL = accountURL
	case notificationKind(actionEraseAbout):
		l.URL = userURL(v.Viewer.ID) + "#about"
	case notificationKind(actionRestoreRecent):
		// Posts of several topics: the tab of the reader's posts lists them.
		l.URL = userURL(v.Viewer.ID)
	}
	if n.TopicID != nil && v.Viewer.CanReadTopic(Topic{DeletedAt: n.TopicDeleted}) {
		if n.PostID != nil {
			l.URL = postURL(*n.PostID)
		} else {
			l.URL = Topic{ID: *n.TopicID}.URL()
		}
	}
	return l
}

type notificationsData struct {
	view
	Lines      []notificationLine
	Pagination pagination
}

// notificationsPage is /forum/notifications: the viewer's notifications, the newest event first. A
// moderator's notification shown here is read by it (task 6.4); it still shows as unread this
// once. Replies and quotes stay unread until the viewer reads the topic.
func (f *Forum) notificationsPage(w http.ResponseWriter, r *http.Request, v view) {
	if !v.Viewer.SignedIn() {
		f.host.RedirectToLogin(w, r)
		return
	}
	page, ok := pageParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	// The total rides on every row: a page past the end has none and is not found.
	rows, err := f.db.Query(r.Context(), `
		SELECT n.id, n.kind, n.topic_id, n.post_id, n.count, n.params, n.updated_at, n.read_at IS NULL,
		       t.deleted_at, count(*) OVER ()
		FROM forum_notifications n
		LEFT JOIN forum_topics t ON t.id = n.topic_id
		WHERE n.user_id = $1
		ORDER BY n.updated_at DESC, n.id DESC
		LIMIT $2 OFFSET $3`, v.Viewer.ID, notificationsPerPage, (page-1)*notificationsPerPage)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	total := 0
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (notificationRow, error) {
		var n notificationRow
		err := row.Scan(&n.ID, &n.Kind, &n.TopicID, &n.PostID, &n.Count, &n.Params, &n.At, &n.Unread,
			&n.TopicDeleted, &total)
		return n, err
	})
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if len(list) == 0 && page > 1 {
		f.host.NotFound(w, r)
		return
	}
	var shown []int
	lines := make([]notificationLine, 0, len(list))
	for _, n := range list {
		if n.Unread && n.moderation() {
			shown = append(shown, n.ID)
		}
		lines = append(lines, n.line(v, f.host.AccountURL()))
	}
	if len(shown) > 0 {
		// The page is worth more than the mark: a failed write is logged and the page served.
		_, err := f.db.Exec(r.Context(), `
			UPDATE forum_notifications SET read_at = $3 WHERE user_id = $1 AND id = ANY($2)`,
			v.Viewer.ID, shown, v.Now)
		if err != nil {
			f.host.LogError(r, err)
		}
	}
	data := notificationsData{
		view:       v,
		Lines:      lines,
		Pagination: pagination{Lang: v.Lang, Path: notificationsURL, Current: page, Total: pageCount(total, notificationsPerPage)},
	}
	f.render(w, r, http.StatusOK, "notifications.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.notifications.title"),
		NoIndex: true,
	})
}

// readAllNotifications is «Mark all as read» of the page of notifications: every unread one of the
// viewer, of any kind. It is the viewer's own state, so a banned user keeps it.
func (f *Forum) readAllNotifications(w http.ResponseWriter, r *http.Request, v view) {
	if !v.Viewer.SignedIn() {
		forbidden(w)
		return
	}
	_, err := f.db.Exec(r.Context(), `
		UPDATE forum_notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL`, v.Viewer.ID, v.Now)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	http.Redirect(w, r, notificationsURL, http.StatusSeeOther)
}
