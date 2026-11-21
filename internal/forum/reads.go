package forum

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

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
// earlier page leaves it alone. In the same statement the notifications the read posts were about
// go out (task 6.4): a quote up to the post is read; the replies keep only what comes after it —
// their link moves to the first visible post of someone else past the post and their count to how
// many such posts there are, and with none left they are read. A moderator's notification is read
// on the page of notifications instead.
func readTopicUpTo(ctx context.Context, db execer, userID, topicID, postID int, at time.Time) error {
	_, err := db.Exec(ctx, `
		WITH mark AS (
			INSERT INTO forum_topic_reads (user_id, topic_id, last_read_post_id) VALUES ($1, $2, $3)
			ON CONFLICT (user_id, topic_id) DO UPDATE SET last_read_post_id = EXCLUDED.last_read_post_id
			WHERE forum_topic_reads.last_read_post_id < EXCLUDED.last_read_post_id
		), rest AS (
			-- What the replies are still about: the user's own posts never notify them.
			SELECT min(id) AS first, count(*) AS n FROM forum_posts
			WHERE topic_id = $2 AND id > $3 AND deleted_at IS NULL AND author_id <> $1
		), done AS (
			UPDATE forum_notifications n SET read_at = $4
			FROM rest
			WHERE n.user_id = $1 AND n.topic_id = $2 AND n.read_at IS NULL AND n.post_id <= $3
			  AND (n.kind = $5 OR n.kind = $6 AND rest.n = 0)
		)
		-- Disjoint from the rows of done by rest.n: no row is updated twice.
		UPDATE forum_notifications n SET post_id = rest.first, count = LEAST(n.count, rest.n)
		FROM rest
		WHERE n.user_id = $1 AND n.topic_id = $2 AND n.read_at IS NULL AND n.post_id <= $3
		  AND n.kind = $6 AND rest.n > 0`,
		userID, topicID, postID, at, string(notifyQuote), string(notifyReplies))
	return err
}

// markRead moves the user's mark of a section, or of the whole forum for a nil section, to the
// newest post in it: everything there is read, what comes after is not. A parent's marks its
// subsections too, each its own mark at its own newest post: a subsection's leaves its siblings.
func (f *Forum) markRead(ctx context.Context, userID int, sectionID *int) error {
	// last_post_id is the newest visible post of a topic, and it is what the unread formula
	// compares the mark with. No topic yet — nothing to mark.
	if sectionID == nil {
		_, err := f.db.Exec(ctx, `
			INSERT INTO forum_read_marks (user_id, section_id, post_id)
			SELECT $1, NULL, max(t.last_post_id) FROM forum_topics t
			HAVING max(t.last_post_id) IS NOT NULL
			ON CONFLICT (user_id, section_id) DO UPDATE SET post_id = EXCLUDED.post_id
			WHERE forum_read_marks.post_id < EXCLUDED.post_id`, userID)
		return err
	}
	_, err := f.db.Exec(ctx, `
		INSERT INTO forum_read_marks (user_id, section_id, post_id)
		SELECT $1, t.section_id, max(t.last_post_id) FROM forum_topics t
		JOIN forum_sections s ON s.id = t.section_id
		WHERE s.id = $2 OR s.parent_id = $2
		GROUP BY t.section_id
		HAVING max(t.last_post_id) IS NOT NULL
		ON CONFLICT (user_id, section_id) DO UPDATE SET post_id = EXCLUDED.post_id
		WHERE forum_read_marks.post_id < EXCLUDED.post_id`, userID, *sectionID)
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
