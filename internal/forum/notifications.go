package forum

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

// A notification keeps its kind and parameters, not a phrase: its page words it in the reader's
// language (_prd/forum/plan.md, «Строки»). Each is written in the transaction of what caused it:
// a reply or a moderator's action. Nobody is notified of their own doing.

// notificationKind is the code of forum_notifications.kind. Codes are stored: never rename one.
// A moderator's action on the reader's content goes under the code of the action in the log
// (notifiedActions). The page words a kind by the key forum.notifications.text.<kind>.
// i18n-keys: forum.notifications.text.*
type notificationKind string

const (
	// notifyReplies gathers the replies to a topic the user is subscribed to: one unread row per
	// user and topic (a unique index), count grows, post_id stays the first of them.
	notifyReplies notificationKind = "replies"
	// notifyQuote is a post that quotes one of the user's posts of the same topic; post_id is the
	// quoting post.
	notifyQuote notificationKind = "quote"
)

// notifiedActions are the moderators' actions that notify the author of their target: those of
// the requirements, and opening, restoring and renaming a topic and lifting a ban (the author's
// answer of 2026-11-19). Pinning a topic and the actions on sections notify nobody.
var notifiedActions = map[modAction]bool{
	actionDeletePost:   true,
	actionRestorePost:  true,
	actionRenameTopic:  true,
	actionMoveTopic:    true,
	actionCloseTopic:   true,
	actionOpenTopic:    true,
	actionDeleteTopic:  true,
	actionRestoreTopic: true,
	actionBanUser:      true,
	actionUnbanUser:    true,
	actionRemoveAvatar: true,
	actionUnlockAvatar: true,
	actionEraseAbout:   true,
	// Restoring one post notifies, so does restoring the posts of a day (the author's answer 3 of
	// results/7.md); deleting them did not: the author hears of the post of the window.
	actionRestoreRecent: true,
}

// notificationsKeptFor: a user's read notifications older than this go when they get a new one,
// without a job (task 6.7).
const notificationsKeptFor = 90 * 24 * time.Hour

// maxQuoteNotifications is how many authors one post notifies by quoting them (decision 12 of the
// plan): a post of many quotes is no way to call a crowd.
const maxQuoteNotifications = 5

// deliver runs an INSERT … RETURNING user_id of notifications, then removes the read notifications
// older than notificationsKeptFor of whoever got one, in the same transaction. It returns who got
// one.
func deliver(ctx context.Context, tx pgx.Tx, at time.Time, insert string, args ...any) ([]int, error) {
	rows, err := tx.Query(ctx, insert, args...)
	if err != nil {
		return nil, err
	}
	users, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil || len(users) == 0 {
		return users, err
	}
	_, err = tx.Exec(ctx, `
		DELETE FROM forum_notifications
		WHERE user_id = ANY($1) AND read_at IS NOT NULL AND updated_at < $2`,
		users, at.Add(-notificationsKeptFor))
	return users, err
}

// notifyOfReply tells of a new post of the topic: its authors whom the post quotes from this
// topic, then the subscribers of the topic who were not quoted. The author of the post gets
// neither. Call it in the transaction of the reply.
func notifyOfReply(ctx context.Context, tx pgx.Tx, topicID, postID, authorID int, body string, at time.Time) error {
	quoted, err := deliver(ctx, tx, at, `
		WITH quoted AS (
			-- The authors in the order the post first quotes them; a quote of another topic
			-- notifies nobody (decision 12).
			SELECT p.author_id FROM unnest($1::int[]) WITH ORDINALITY AS q(id, n)
			JOIN forum_posts p ON p.id = q.id
			-- A deleted account gets nothing (plan _prd/account_deletion, section 3).
			JOIN users a ON a.id = p.author_id AND a.status <> 'deleted'
			WHERE p.topic_id = $2 AND p.author_id <> $4
			GROUP BY p.author_id
			ORDER BY min(q.n)
			LIMIT $6
		)
		INSERT INTO forum_notifications (user_id, kind, topic_id, post_id, params, created_at, updated_at)
		SELECT quoted.author_id, $7, t.id, $3, jsonb_build_object('title', t.title, 'name', u.name), $5, $5
		FROM quoted, forum_topics t, users u
		WHERE t.id = $2 AND u.id = $4
		RETURNING user_id`,
		quotedPosts(body), topicID, postID, authorID, at, maxQuoteNotifications, string(notifyQuote))
	if err != nil {
		return err
	}
	_, err = deliver(ctx, tx, at, `
		INSERT INTO forum_notifications (user_id, kind, topic_id, post_id, params, created_at, updated_at)
		SELECT s.user_id, $5, t.id, $2, jsonb_build_object('title', t.title), $4, $4
		FROM forum_subscriptions s
		JOIN forum_topics t ON t.id = s.topic_id
		WHERE s.topic_id = $1 AND s.user_id <> $3 AND s.user_id <> ALL(COALESCE($6::int[], '{}'))
		ON CONFLICT (user_id, topic_id) WHERE kind = 'replies' AND read_at IS NULL
		DO UPDATE SET count = forum_notifications.count + 1,
		              params = EXCLUDED.params,
		              updated_at = EXCLUDED.updated_at
		RETURNING user_id`,
		topicID, postID, authorID, at, string(notifyReplies), quoted)
	return err
}

// quotedPosts are the posts whose quote heads the Markdown holds, each once, in the order of the
// text: the links of the heads quoteHeadTransformer finds (results/3.md, «Как разбирать»). The
// name in a head is not trusted: the quoted post names its author.
func quotedPosts(body string) []int {
	source := []byte(body)
	ids := []int{}
	seen := map[int]bool{}
	ast.Walk(markdown.Parser().Parse(text.NewReader(source)), func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if _, ok := n.(*quoteHeadNode); !ok {
			return ast.WalkContinue, nil
		}
		for c := n.FirstChild(); c != nil; c = c.NextSibling() {
			l, ok := c.(*ast.Link)
			if !ok || !quotedPostPath.Match(l.Destination) {
				continue
			}
			id, err := strconv.Atoi(strings.TrimPrefix(string(l.Destination), "/forum/post/"))
			// An id past int4 is no post, and would fail the whole query.
			if err != nil || id > math.MaxInt32 || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
		// A head holds no quote; the quotes nested in this one are its siblings.
		return ast.WalkSkipChildren, nil
	})
	return ids
}

// notifyOfModeration tells the author of the target of a moderator's action of it, in the
// transaction of moderate; a moderator's action on their own content notifies nobody. The
// parameters keep the title of the topic at the time (the new one after a rename, with the old),
// the moderator's reason, the section a topic went to and the end of a ban. Lifting a ban has no
// topic and no parameters.
func notifyOfModeration(ctx context.Context, tx pgx.Tx, e modEntry) error {
	if !notifiedActions[e.Action] {
		return nil
	}
	// The recipient is a column of the query below.
	recipient := "t.author_id"
	switch e.Action {
	case actionDeletePost, actionRestorePost:
		recipient = "p.author_id"
	case actionBanUser, actionUnbanUser, actionRemoveAvatar, actionUnlockAvatar, actionEraseAbout, actionRestoreRecent:
		recipient = "u.id"
	}
	params := map[string]any{}
	if e.Reason != "" {
		params["reason"] = e.Reason
	}
	switch e.Action {
	case actionBanUser:
		// null: until lifted.
		params["expiresAt"] = e.Data["expiresAt"]
	case actionRenameTopic:
		params["oldTitle"] = e.Data["title"]
	case actionRestoreRecent:
		if posts, ok := e.Data["posts"].([]int); ok {
			params["count"] = len(posts)
		}
	case actionRemoveAvatar:
		// lock: none, 7, 30 or forever; lockUntil is the end of a term, null otherwise.
		params["lock"], params["lockUntil"] = e.Data["lock"], e.Data["lockUntil"]
	}
	_, err := deliver(ctx, tx, e.At, `
		INSERT INTO forum_notifications (user_id, kind, topic_id, post_id, params, created_at, updated_at)
		SELECT `+recipient+`, $1, t.id, p.id,
		       jsonb_strip_nulls(jsonb_build_object('title', t.title))
		       || CASE WHEN $1 = '`+string(actionMoveTopic)+`' THEN jsonb_build_object('section', s.name) ELSE '{}' END
		       || $5::jsonb,
		       $6, $6
		-- Every target may be missing: lifting a ban has only its user.
		FROM (SELECT) one
		LEFT JOIN forum_topics t ON t.id = $2
		LEFT JOIN forum_sections s ON s.id = t.section_id
		LEFT JOIN forum_posts p ON p.id = $3
		LEFT JOIN users u ON u.id = $4
		WHERE `+recipient+` IS NOT NULL AND `+recipient+` <> $7
		  -- A deleted account gets nothing (plan _prd/account_deletion, section 3).
		  AND NOT EXISTS (SELECT 1 FROM users r WHERE r.id = `+recipient+` AND r.status = 'deleted')
		RETURNING user_id`,
		string(e.Action), e.TopicID, e.PostID, e.UserID, params, e.At, e.ModeratorID)
	return err
}

// UnreadNotifications is the counter next to the forum link of the site nav: one query by the
// index of unread notifications.
func (f *Forum) UnreadNotifications(ctx context.Context, userID int) (int, error) {
	var n int
	err := f.db.QueryRow(ctx, `
		SELECT count(*) FROM forum_notifications WHERE user_id = $1 AND read_at IS NULL`, userID).Scan(&n)
	return n, err
}

// subscribe makes the user get the replies of the topic; already subscribed, nothing changes.
func subscribe(ctx context.Context, db execer, userID, topicID int, at time.Time) error {
	_, err := db.Exec(ctx, `
		INSERT INTO forum_subscriptions (user_id, topic_id, created_at) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, topic_id) DO NOTHING`, userID, topicID, at)
	return err
}

// subscription is the button «Subscribe / ✓ Subscribed» of a topic head (design/decisions.md, 16):
// POST /forum/topic/{id}/subscribe and …/unsubscribe, then back to the page of the topic the form
// names. A guest and a banned user, who get no button, get 403; a topic the viewer cannot read is
// not found.
func (f *Forum) subscription(on bool) func(http.ResponseWriter, *http.Request, view) {
	return func(w http.ResponseWriter, r *http.Request, v view) {
		id, ok := idParam(r)
		if !ok {
			f.host.NotFound(w, r)
			return
		}
		if !v.Viewer.SignedIn() {
			forbidden(w)
			return
		}
		t, err := f.loadTopic(r.Context(), id, v.Viewer.ID)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !v.Viewer.CanReadTopic(t.Topic) {
			f.host.NotFound(w, r)
			return
		}
		if err != nil {
			f.host.ServerError(w, r, err)
			return
		}
		if !v.Viewer.CanSubscribe(t.Topic) {
			forbidden(w)
			return
		}
		if on {
			err = subscribe(r.Context(), f.db, v.Viewer.ID, t.ID, v.Now)
		} else {
			_, err = f.db.Exec(r.Context(), `
				DELETE FROM forum_subscriptions WHERE user_id = $1 AND topic_id = $2`, v.Viewer.ID, t.ID)
		}
		if err != nil {
			f.host.ServerError(w, r, err)
			return
		}
		// A page past the end is still a page of the topic: its own handler answers it.
		page, err := strconv.Atoi(r.PostFormValue("page"))
		if err != nil || page < 1 {
			page = 1
		}
		http.Redirect(w, r, pageURL(t.URL(), page), http.StatusSeeOther)
	}
}
