package forum

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// Topic is a row of forum_topics.
type Topic struct {
	ID         int
	SectionID  int
	AuthorID   int
	Title      string
	Pinned     bool
	Closed     bool
	CreatedAt  time.Time
	DeletedAt  *time.Time
	ReplyCount int
	LastPostID *int
	LastPostAt time.Time
}

func (t Topic) Deleted() bool {
	return t.DeletedAt != nil
}

// recountTopic counts reply_count, last_post_id and last_post_at of the topic from its visible
// posts. Call it in the transaction that creates, deletes or restores a post of the topic, after
// the change.
func recountTopic(ctx context.Context, tx pgx.Tx, topicID int) error {
	// The lock is a statement of its own: under READ COMMITTED the UPDATE below then takes its
	// snapshot after a concurrent post of the same topic has committed. Inside one statement the
	// subqueries would keep the snapshot from before the wait and miss that post. NO KEY: FOR UPDATE
	// conflicts with the key share lock an insert into forum_posts takes on its topic, and two
	// replies that both inserted before recounting would deadlock.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM forum_topics WHERE id = $1 FOR NO KEY UPDATE`, topicID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE forum_topics t
		SET reply_count  = r.n,
		    last_post_id = l.id,
		    last_post_at = COALESCE(l.created_at, t.created_at)
		FROM (
			-- The first post opens the topic even when deleted: it is never a reply.
			SELECT count(*) AS n FROM forum_posts
			WHERE topic_id = $1 AND deleted_at IS NULL
			  AND id > (SELECT min(id) FROM forum_posts WHERE topic_id = $1)
		) r
		LEFT JOIN LATERAL (
			SELECT id, created_at FROM forum_posts
			WHERE topic_id = $1 AND deleted_at IS NULL
			ORDER BY id DESC LIMIT 1
		) l ON true
		WHERE t.id = $1`, topicID)
	return err
}

func (t Topic) URL() string {
	return "/forum/topic/" + strconv.Itoa(t.ID)
}

func postURL(id int) string {
	return "/forum/post/" + strconv.Itoa(id)
}

// createTopic opens a topic with its first post at the given time, in one transaction with the
// recount, the author's read mark and their subscription (decision 11 of the plan). The caller
// checks the rights and the lengths.
func (f *Forum) createTopic(ctx context.Context, sectionID, authorID int, title, body string, at time.Time) (topicID, postID int, err error) {
	err = pgx.BeginFunc(ctx, f.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO forum_topics (section_id, author_id, title, created_at, last_post_at)
			VALUES ($1, $2, $3, $4, $4) RETURNING id`, sectionID, authorID, title, at).Scan(&topicID)
		if err != nil {
			return err
		}
		if postID, err = insertPost(ctx, tx, topicID, authorID, body, at); err != nil {
			return err
		}
		if err := recountTopic(ctx, tx, topicID); err != nil {
			return err
		}
		if err := subscribe(ctx, tx, authorID, topicID, at); err != nil {
			return err
		}
		return readTopicUpTo(ctx, tx, authorID, topicID, postID, at)
	})
	if err != nil {
		return 0, 0, err
	}
	return topicID, postID, nil
}

// reply adds a post to the topic at the given time, in one transaction with the recount, the
// author's read mark and the notifications of the post. A reply does not subscribe its author
// (decision 11 of the plan). The caller checks the rights (CanReply) and the length.
func (f *Forum) reply(ctx context.Context, topicID, authorID int, body string, at time.Time) (postID int, err error) {
	err = pgx.BeginFunc(ctx, f.db, func(tx pgx.Tx) error {
		if postID, err = insertPost(ctx, tx, topicID, authorID, body, at); err != nil {
			return err
		}
		if err := recountTopic(ctx, tx, topicID); err != nil {
			return err
		}
		// The author has read up to their post: their own reply never makes the topic unread.
		if err := readTopicUpTo(ctx, tx, authorID, topicID, postID, at); err != nil {
			return err
		}
		return notifyOfReply(ctx, tx, topicID, postID, authorID, body, at)
	})
	if err != nil {
		return 0, err
	}
	return postID, nil
}

func insertPost(ctx context.Context, tx pgx.Tx, topicID, authorID int, body string, at time.Time) (int, error) {
	var id int
	err := tx.QueryRow(ctx, `
		INSERT INTO forum_posts (topic_id, author_id, body, created_at) VALUES ($1, $2, $3, $4)
		RETURNING id`, topicID, authorID, body, at).Scan(&id)
	return id, err
}

// topicPage is a topic as its page shows it.
type topicPage struct {
	Topic
	AuthorName string
	Section    Section
	// PostCount counts the deleted posts too: they keep their place and pages.
	PostCount int
	// FirstPost is the beginning of the first post for the page description, empty when it is
	// deleted.
	FirstPost string
	// Who deleted the topic and why, from the log, for the moderator who opens it; empty while it
	// stands.
	DeletedByID   int
	DeletedByName string
	DeleteReason  string
	// Subscribed: the viewer gets the replies of the topic (block 6).
	Subscribed bool
}

// loadTopic reads the topic with its section and whether the viewer (0: a guest) is subscribed to
// it in one query; pgx.ErrNoRows for a topic that does not exist. Whether the viewer may read it is
// the caller's question (CanReadTopic).
func (f *Forum) loadTopic(ctx context.Context, id, viewerID int) (topicPage, error) {
	var t topicPage
	var first, deletedBy, reason *string
	var deletedByID *int
	err := f.db.QueryRow(ctx, `
		SELECT t.id, t.section_id, t.author_id, t.title, t.pinned, t.closed, t.created_at, t.deleted_at,
		       t.reply_count, t.last_post_id, t.last_post_at, a.name,
		       s.id, s.name, s.description, s.position, s.mods_only_topics,
		       (SELECT count(*) FROM forum_posts p WHERE p.topic_id = t.id),
		       fp.body, d.id, d.name,
		       (SELECT l.reason FROM forum_mod_log l
		        WHERE t.deleted_at IS NOT NULL AND l.topic_id = t.id AND l.action = $2
		        ORDER BY l.id DESC LIMIT 1),
		       EXISTS (SELECT 1 FROM forum_subscriptions sub WHERE sub.user_id = $3 AND sub.topic_id = t.id)
		FROM forum_topics t
		JOIN forum_sections s ON s.id = t.section_id
		JOIN users a ON a.id = t.author_id
		LEFT JOIN users d ON d.id = t.deleted_by AND t.deleted_at IS NOT NULL
		LEFT JOIN LATERAL (
			-- Enough of the text for a description; a cut in the middle of the Markdown only
			-- costs its tail.
			SELECT CASE WHEN p.deleted_at IS NULL THEN left(p.body, 2000) END AS body
			FROM forum_posts p WHERE p.topic_id = t.id ORDER BY p.id LIMIT 1
		) fp ON true
		WHERE t.id = $1`, id, string(actionDeleteTopic), viewerID).
		Scan(&t.ID, &t.SectionID, &t.AuthorID, &t.Title, &t.Pinned, &t.Closed, &t.CreatedAt, &t.DeletedAt,
			&t.ReplyCount, &t.LastPostID, &t.LastPostAt, &t.AuthorName,
			&t.Section.ID, &t.Section.Name, &t.Section.Description, &t.Section.Position, &t.Section.ModsOnlyTopics,
			&t.PostCount, &first, &deletedByID, &deletedBy, &reason, &t.Subscribed)
	if first != nil {
		t.FirstPost = *first
	}
	if deletedBy != nil {
		t.DeletedByID, t.DeletedByName = *deletedByID, *deletedBy
	}
	if reason != nil {
		t.DeleteReason = *reason
	}
	return t, err
}

// post is a post of the topic page.
type post struct {
	ID       int
	AuthorID int
	// Body is empty for a deleted post unless the viewer reads deleted posts (a moderator): its
	// text never reaches the template of anyone else.
	Body      string
	CreatedAt time.Time
	EditedAt  *time.Time
	DeletedAt *time.Time
	// Who deleted the post and the reason of a moderator, for a moderator only; empty otherwise.
	DeletedByID   int
	DeletedByName string
	DeleteReason  string
	// Number is the place of the post in the topic, from 1.
	Number             int
	AuthorName         string
	AuthorRegisteredAt time.Time
	// AuthorPosts counts the visible posts of the author in topics that are not deleted: what a
	// guest can find.
	AuthorPosts int
	// AuthorModerator shows the moderator's role, which a name cannot fake (_prd/forum/plan.md,
	// amendment 6).
	AuthorModerator bool
	// AuthorAvatar is the URL of the author's avatar from the host, empty without one.
	AuthorAvatar string
}

func (p post) Deleted() bool {
	return p.DeletedAt != nil
}

func (p post) URL() string {
	return postURL(p.ID)
}

func (p post) Avatar() avatar {
	return newAvatar(p.AuthorAvatar, p.AuthorName, p.AuthorID, avatarSize)
}

// First is the post that opens the topic.
func (p post) First() bool {
	return p.Number == 1
}

// postCard is what the template "forum-post" draws: a post of a topic, with the actions under it
// that the viewer may take, or without any (the post on the page that confirms its deletion).
type postCard struct {
	view
	Topic   Topic
	Post    post
	Actions bool
}

// Card is a post for the template "forum-post": {{template "forum-post" ($.Card $.Topic.Topic . true)}}.
func (v view) Card(t Topic, p post, actions bool) postCard {
	return postCard{view: v, Topic: t, Post: p, Actions: actions}
}

// lonePostCard is the post a page of its own acts on (delete, restore, ban), without the actions,
// with its author's avatar fetched for it alone.
func (f *Forum) lonePostCard(r *http.Request, v view, p postTarget) postCard {
	p.AuthorAvatar = f.avatars(r, p.AuthorID)[p.AuthorID]
	return v.Card(p.Topic.Topic, p.post, false)
}

// topicPosts reads one page of the topic with its authors and their post counts in one query.
// What a deleted post holds comes only to a viewer who reads deleted posts.
func (f *Forum) topicPosts(ctx context.Context, topicID, page int, v Viewer) ([]post, error) {
	offset := (page - 1) * postsPerPage
	rows, err := f.db.Query(ctx, `
		WITH page AS (
			SELECT id, author_id, CASE WHEN deleted_at IS NULL OR $4 THEN body ELSE '' END AS body,
			       created_at, edited_at, deleted_at, deleted_by
			FROM forum_posts
			WHERE topic_id = $1
			ORDER BY id
			LIMIT $2 OFFSET $3
		), counts AS (
			SELECT p.author_id, count(*) AS n
			FROM forum_posts p
			JOIN forum_topics t ON t.id = p.topic_id
			WHERE p.author_id IN (SELECT author_id FROM page)
			  AND p.deleted_at IS NULL AND t.deleted_at IS NULL
			GROUP BY p.author_id
		)
		SELECT page.id, page.author_id, page.body, page.created_at, page.edited_at, page.deleted_at,
		       u.name, u.created_at, COALESCE(c.n, 0),
		       EXISTS (SELECT 1 FROM forum_moderators m WHERE m.user_id = page.author_id),
		       COALESCE(d.id, 0), COALESCE(d.name, ''), `+deleteReasonSQL("page", "$4")+`
		FROM page
		JOIN users u ON u.id = page.author_id
		LEFT JOIN counts c ON c.author_id = page.author_id
		LEFT JOIN users d ON $4 AND d.id = page.deleted_by AND page.deleted_at IS NOT NULL
		ORDER BY page.id`, topicID, postsPerPage, offset, v.CanReadDeletedPosts())
	if err != nil {
		return nil, err
	}
	posts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (post, error) {
		var p post
		err := row.Scan(&p.ID, &p.AuthorID, &p.Body, &p.CreatedAt, &p.EditedAt, &p.DeletedAt,
			&p.AuthorName, &p.AuthorRegisteredAt, &p.AuthorPosts, &p.AuthorModerator,
			&p.DeletedByID, &p.DeletedByName, &p.DeleteReason)
		return p, err
	})
	for i := range posts {
		posts[i].Number = offset + i + 1
	}
	return posts, err
}

type topicData struct {
	view
	Topic      topicPage
	Posts      []post
	Pagination pagination
	// Form is the reply form under the last page, with what was typed when it had an error.
	Form postForm
	// ViewerAvatar is the URL of the viewer's avatar for the reply form, empty without one.
	ViewerAvatar string
}

func (d topicData) ReplyAvatar() avatar {
	return newAvatar(d.ViewerAvatar, d.Viewer.Name, d.Viewer.ID, replyAvatarSize)
}

func (f *Forum) topic(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	page, pageOK := pageParam(r)
	if !ok || !pageOK {
		f.host.NotFound(w, r)
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
	if page > pageCount(t.PostCount, postsPerPage) {
		f.host.NotFound(w, r)
		return
	}
	f.renderTopic(w, r, v, t, page, postForm{}, http.StatusOK, false)
}

// renderTopic shows an existing page of a topic the viewer may read. noIndex is for the addresses
// that show it with something in the reply form: a quote, a preview, an error.
func (f *Forum) renderTopic(w http.ResponseWriter, r *http.Request, v view, t topicPage, page int, form postForm, status int, noIndex bool) {
	posts, err := f.topicPosts(r.Context(), t.ID, page, v.Viewer)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if v.Viewer.SignedIn() && len(posts) > 0 {
		// The page is worth more than the mark: a failed write is logged and the page served.
		if err := readTopicUpTo(r.Context(), f.db, v.Viewer.ID, t.ID, posts[len(posts)-1].ID, v.Now); err != nil {
			f.host.LogError(r, err)
		}
	}
	// The authors of the page and the viewer for the reply form, in one call.
	ids := make([]int, 0, len(posts)+1)
	for _, p := range posts {
		ids = append(ids, p.AuthorID)
	}
	avatars := f.avatars(r, append(ids, v.Viewer.ID)...)
	for i := range posts {
		posts[i].AuthorAvatar = avatars[posts[i].AuthorID]
	}
	description := plainText(t.FirstPost, descriptionLength)
	if description == "" {
		description = t.Title
	}
	data := topicData{
		view:         v,
		Topic:        t,
		Posts:        posts,
		Pagination:   pagination{Lang: v.Lang, Path: t.URL(), Current: page, Total: pageCount(t.PostCount, postsPerPage)},
		Form:         form,
		ViewerAvatar: avatars[v.Viewer.ID],
	}
	f.render(w, r, status, "topic.html", data, Page{
		Title:       pageTitle(v.Lang, t.Title, page),
		Description: description,
		Canonical:   f.baseURL + pageURL(t.URL(), page),
		NoIndex:     noIndex,
	})
}

// post sends /forum/post/{id} to the page of its topic that holds it, with its anchor. Deleted
// posts keep their place, so the page of a post never changes.
func (f *Forum) post(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	var t Topic
	var before int
	err := f.db.QueryRow(r.Context(), `
		SELECT t.id, t.deleted_at,
		       (SELECT count(*) FROM forum_posts q WHERE q.topic_id = p.topic_id AND q.id < p.id)
		FROM forum_posts p
		JOIN forum_topics t ON t.id = p.topic_id
		WHERE p.id = $1`, id).Scan(&t.ID, &t.DeletedAt, &before)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !v.Viewer.CanReadTopic(t) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	page := before/postsPerPage + 1
	http.Redirect(w, r, pageURL(t.URL(), page)+"#post-"+strconv.Itoa(id), http.StatusFound)
}
