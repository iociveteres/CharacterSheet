package forum

import (
	"context"
	"errors"
	"net/http"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgx/v5"
)

// postTarget is one post with its topic: what the pages that edit or delete a post work on.
type postTarget struct {
	post
	Topic topicPage
}

// loadPost reads the post with its place in the topic, then its topic; pgx.ErrNoRows for a post
// that does not exist. As on the topic page, a deleted post comes without its text unless the
// viewer reads deleted posts.
func (f *Forum) loadPost(ctx context.Context, id int, v Viewer) (postTarget, error) {
	var p postTarget
	var topicID int
	err := f.db.QueryRow(ctx, `
		SELECT p.id, p.topic_id, p.author_id, CASE WHEN p.deleted_at IS NULL OR $2 THEN p.body ELSE '' END,
		       p.created_at, p.edited_at, p.deleted_at,
		       (SELECT count(*) FROM forum_posts q WHERE q.topic_id = p.topic_id AND q.id < p.id) + 1,
		       u.name, u.created_at,
		       (SELECT count(*) FROM forum_posts q JOIN forum_topics t ON t.id = q.topic_id
		        WHERE q.author_id = p.author_id AND q.deleted_at IS NULL AND t.deleted_at IS NULL),
		       EXISTS (SELECT 1 FROM forum_moderators m WHERE m.user_id = p.author_id),
		       COALESCE(d.name, ''), `+deleteReasonSQL("p", "$2")+`
		FROM forum_posts p
		JOIN users u ON u.id = p.author_id
		LEFT JOIN users d ON $2 AND d.id = p.deleted_by AND p.deleted_at IS NOT NULL
		WHERE p.id = $1`, id, v.CanReadDeletedPosts()).
		Scan(&p.ID, &topicID, &p.AuthorID, &p.Body, &p.CreatedAt, &p.EditedAt, &p.DeletedAt, &p.Number,
			&p.AuthorName, &p.AuthorRegisteredAt, &p.AuthorPosts, &p.AuthorModerator,
			&p.DeletedByName, &p.DeleteReason)
	if err != nil {
		return postTarget{}, err
	}
	p.Topic, err = f.loadTopic(ctx, topicID)
	return p, err
}

// postToActOn loads the post of /forum/post/{id}/edit, /delete or /quote and asks may whether the
// viewer may do that: a guest goes to sign in and back, a post the viewer cannot read is not found,
// an action the page did not offer gets 403. False when it has answered.
func (f *Forum) postToActOn(w http.ResponseWriter, r *http.Request, v view, may func(Viewer, Topic, post) bool) (postTarget, bool) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return postTarget{}, false
	}
	if !v.Viewer.SignedIn() {
		f.host.RedirectToLogin(w, r)
		return postTarget{}, false
	}
	p, err := f.loadPost(r.Context(), id, v.Viewer)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !v.Viewer.CanReadTopic(p.Topic.Topic) {
		f.host.NotFound(w, r)
		return postTarget{}, false
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return postTarget{}, false
	}
	if !may(v.Viewer, p.Topic.Topic, p.post) {
		forbidden(w)
		return postTarget{}, false
	}
	return p, true
}

type editPostData struct {
	view
	Post postTarget
	Form postForm
}

// editPost is the page of the form that edits a post and the address it posts to. Only the text
// changes, of the first post too: the title of a topic is the moderators' (block 5). A text sent
// unchanged leaves the post as it was, without the "edited" mark.
func (f *Forum) editPost(w http.ResponseWriter, r *http.Request, v view) {
	p, ok := f.postToActOn(w, r, v, Viewer.CanEditPost)
	if !ok {
		return
	}
	data := editPostData{view: v, Post: p, Form: postForm{Body: p.Body}}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		form, err := readPostForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if form.tab {
			status = form.tabStatus(v.Lang)
			data.Form = form
		} else if form.checkBody(v.Lang); form.Valid() {
			if form.Body != p.Body {
				if err := f.updatePost(r.Context(), p.ID, form.Body, v.Now); err != nil {
					f.host.ServerError(w, r, err)
					return
				}
			}
			http.Redirect(w, r, p.URL(), http.StatusSeeOther)
			return
		} else {
			data.Form, status = form, http.StatusUnprocessableEntity
		}
	}
	f.render(w, r, status, "post_edit.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.posts.editTitle"),
		NoIndex: true,
	})
}

// updatePost changes the text of a post that is not deleted and marks it edited at the given time.
func (f *Forum) updatePost(ctx context.Context, id int, body string, at time.Time) error {
	_, err := f.db.Exec(ctx, `
		UPDATE forum_posts SET body = $2, edited_at = $3 WHERE id = $1 AND deleted_at IS NULL`, id, body, at)
	return err
}

type deletePostData struct {
	view
	Post postTarget
	// Card is the post as the topic shows it, without the actions under it.
	Card postCard
	// ByModerator: a moderator deletes another's post, with a reason that goes to the log.
	ByModerator bool
	Form        modForm
}

// deletePost is the page that asks to confirm deleting a post, without a script, and the address
// its form posts to. The post keeps its place in the topic; the browser goes back to it, to the
// line that says it is deleted. Another's post deleted by a moderator goes through moderate.
func (f *Forum) deletePost(w http.ResponseWriter, r *http.Request, v view) {
	p, ok := f.postToActOn(w, r, v, Viewer.CanDeletePost)
	if !ok {
		return
	}
	data := deletePostData{view: v, Post: p, Card: v.Card(p.Topic.Topic, p.post, false), ByModerator: v.Viewer.DeletesAsModerator(p.post)}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		if !data.ByModerator {
			if err := f.softDeletePost(r.Context(), p.ID, v.Viewer.ID, v.Now); err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			http.Redirect(w, r, p.URL(), http.StatusSeeOther)
			return
		}
		form, err := readModForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if f.moderatePost(w, r, v, p, false, &form) {
			return
		}
		data.Form, status = form, http.StatusUnprocessableEntity
	}
	f.render(w, r, status, "post_delete.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.posts.deleteTitle"),
		NoIndex: true,
	})
}

// softDeletePost is the author deleting their own post: deletePostTx in a transaction of its own,
// without the log. A post already deleted stays as it was.
func (f *Forum) softDeletePost(ctx context.Context, id, by int, at time.Time) error {
	err := pgx.BeginFunc(ctx, f.db, func(tx pgx.Tx) error {
		return deletePostTx(ctx, tx, id, by, at)
	})
	if errors.Is(err, errNoChange) {
		return nil
	}
	return err
}
