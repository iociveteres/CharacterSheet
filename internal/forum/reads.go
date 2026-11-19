package forum

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// What is unread is counted only for a signed-in viewer (_prd/forum/plan.md, «Непрочитанное»): a
// topic is unread when its last_post_id is past all three marks of the viewer — of the topic
// (forum_topic_reads), of its section and of the whole forum (forum_read_marks) — and its last post
// is newer than the viewer's registration. The lists read the marks in the query that reads them.

// execer is a pool or a transaction.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// readTopicUpTo records that the user has read the topic up to the post: when a page of the topic
// is shown to them, and when they post in it. The mark only moves forward, so going back to an
// earlier page leaves it alone.
func readTopicUpTo(ctx context.Context, db execer, userID, topicID, postID int) error {
	_, err := db.Exec(ctx, `
		INSERT INTO forum_topic_reads (user_id, topic_id, last_read_post_id) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, topic_id) DO UPDATE SET last_read_post_id = EXCLUDED.last_read_post_id
		WHERE forum_topic_reads.last_read_post_id < EXCLUDED.last_read_post_id`, userID, topicID, postID)
	return err
}

// markRead moves the user's mark of a section, or of the whole forum for a nil section, to the
// newest post in it: everything there is read, what comes after is not.
func (f *Forum) markRead(ctx context.Context, userID int, sectionID *int) error {
	// last_post_id is the newest visible post of a topic, and it is what the unread formula
	// compares the mark with. No topic yet — nothing to mark.
	_, err := f.db.Exec(ctx, `
		INSERT INTO forum_read_marks (user_id, section_id, post_id)
		SELECT $1, $2::int, max(t.last_post_id) FROM forum_topics t
		WHERE $2::int IS NULL OR t.section_id = $2
		HAVING max(t.last_post_id) IS NOT NULL
		ON CONFLICT (user_id, section_id) DO UPDATE SET post_id = EXCLUDED.post_id
		WHERE forum_read_marks.post_id < EXCLUDED.post_id`, userID, sectionID)
	return err
}

// markAllRead is «Mark all as read» of the forum home.
func (f *Forum) markAllRead(w http.ResponseWriter, r *http.Request, v view) {
	if !v.Viewer.SignedIn() {
		forbidden(w)
		return
	}
	if err := f.markRead(r.Context(), v.Viewer.ID, nil); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	http.Redirect(w, r, "/forum/", http.StatusSeeOther)
}

// markSectionRead is «Mark as read» of a section page.
func (f *Forum) markSectionRead(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	if !v.Viewer.SignedIn() {
		forbidden(w)
		return
	}
	var exists bool
	if err := f.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM forum_sections WHERE id = $1)`, id).Scan(&exists); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if !exists {
		f.host.NotFound(w, r)
		return
	}
	if err := f.markRead(r.Context(), v.Viewer.ID, &id); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	http.Redirect(w, r, Section{ID: id}.URL(), http.StatusSeeOther)
}

func (t Topic) UnreadURL() string {
	return t.URL() + "/unread"
}

// firstUnread sends /forum/topic/{id}/unread to the page and anchor of the first post the viewer
// has not read, or to the first page when every post is read or the viewer is a guest. Deleted
// posts are not news: the first unread one is visible.
func (f *Forum) firstUnread(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	t := Topic{ID: id}
	var postID *int
	var before int
	// A guest is user 0: no marks join and $2 > 0 skips the search for the first unread post.
	err := f.db.QueryRow(r.Context(), `
		SELECT t.deleted_at, u.id, COALESCE(u.before, 0)
		FROM forum_topics t
		LEFT JOIN forum_topic_reads r ON r.user_id = $2 AND r.topic_id = t.id
		LEFT JOIN forum_read_marks sm ON sm.user_id = $2 AND sm.section_id = t.section_id
		LEFT JOIN forum_read_marks fm ON fm.user_id = $2 AND fm.section_id IS NULL
		LEFT JOIN LATERAL (
			SELECT p.id, (SELECT count(*) FROM forum_posts q WHERE q.topic_id = t.id AND q.id < p.id) AS before
			FROM forum_posts p
			WHERE $2 > 0 AND p.topic_id = t.id AND p.deleted_at IS NULL AND p.created_at > $3
			  AND p.id > GREATEST(r.last_read_post_id, sm.post_id, fm.post_id, 0)
			ORDER BY p.id
			LIMIT 1
		) u ON true
		WHERE t.id = $1`, id, v.Viewer.ID, v.Viewer.RegisteredAt).Scan(&t.DeletedAt, &postID, &before)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !v.Viewer.CanReadTopic(t) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	target := t.URL()
	if postID != nil {
		target = pageURL(t.URL(), before/postsPerPage+1) + "#post-" + strconv.Itoa(*postID)
	}
	http.Redirect(w, r, target, http.StatusFound)
}
