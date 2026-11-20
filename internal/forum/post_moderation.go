package forum

import (
	"context"
	"errors"
	"net/http"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgx/v5"
)

// deleteReasonSQL is the reason of the moderator who deleted the post of the query's alias (its
// columns id and deleted_at), read only while flag (a bool parameter) holds: the last deletion or
// restoration of the post in the log, if it is a deletion. A post its author deleted after a
// moderator restored it has none.
func deleteReasonSQL(alias, flag string) string {
	return `COALESCE((SELECT CASE WHEN l.action = '` + string(actionDeletePost) + `' THEN l.reason END
		FROM forum_mod_log l
		WHERE ` + flag + ` AND ` + alias + `.deleted_at IS NOT NULL AND l.post_id = ` + alias + `.id
		  AND l.action IN ('` + string(actionDeletePost) + `', '` + string(actionRestorePost) + `')
		ORDER BY l.id DESC LIMIT 1), '')`
}

// deletePostTx marks the post deleted by whom and when and recounts its topic; errNoChange for a
// post already deleted.
func deletePostTx(ctx context.Context, tx pgx.Tx, id, by int, at time.Time) error {
	var topicID int
	err := tx.QueryRow(ctx, `
		UPDATE forum_posts SET deleted_at = $2, deleted_by = $3
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING topic_id`, id, at, by).Scan(&topicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoChange
	}
	if err != nil {
		return err
	}
	return recountTopic(ctx, tx, topicID)
}

// postChange is the log entry and the change of a moderator deleting another's post or restoring a
// deleted one; both recount the topic in the transaction of moderate.
func postChange(restore bool, p postTarget, reason string, by int, at time.Time) (modEntry, modChange) {
	e := modEntry{Action: actionDeletePost, PostID: p.ID, TopicID: p.Topic.ID, Reason: reason}
	if !restore {
		return e, func(ctx context.Context, tx pgx.Tx, _ *modEntry) error {
			return deletePostTx(ctx, tx, p.ID, by, at)
		}
	}
	e.Action = actionRestorePost
	return e, func(ctx context.Context, tx pgx.Tx, _ *modEntry) error {
		tag, err := tx.Exec(ctx, `
			UPDATE forum_posts SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND deleted_at IS NOT NULL`, p.ID)
		if err := changed(tag.RowsAffected(), err); err != nil {
			return err
		}
		return recountTopic(ctx, tx, p.Topic.ID)
	}
}

// moderatePost writes the moderator's deletion or restoration of the post from its form, or gives
// back the form with an error. False when the form had an error and the page is to be shown again
// with data.Form.
func (f *Forum) moderatePost(w http.ResponseWriter, r *http.Request, v view, p postTarget, restore bool, form *modForm) bool {
	form.checkReason(v.Lang)
	if !form.Valid() {
		return false
	}
	entry, change := postChange(restore, p, form.Reason, v.Viewer.ID, v.Now)
	if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, change); err != nil {
		f.host.ServerError(w, r, err)
		return true
	}
	http.Redirect(w, r, p.URL(), http.StatusSeeOther)
	return true
}

type restorePostData struct {
	view
	Post postTarget
	// Card is the deleted post as a moderator sees it in the topic, without the actions under it.
	Card postCard
	Form modForm
}

// restorePost is the page of a moderator bringing back a deleted post, whoever deleted it, and the
// address its form posts to. The browser goes back to the post.
func (f *Forum) restorePost(w http.ResponseWriter, r *http.Request, v view) {
	p, ok := f.postToActOn(w, r, v, Viewer.CanRestorePost)
	if !ok {
		return
	}
	data := restorePostData{view: v, Post: p, Card: f.lonePostCard(r, v, p)}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		form, err := readModForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if f.moderatePost(w, r, v, p, true, &form) {
			return
		}
		data.Form, status = form, http.StatusUnprocessableEntity
	}
	f.render(w, r, status, "post_restore.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.moderation.restorePost"),
		NoIndex: true,
	})
}
