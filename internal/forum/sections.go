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

type Section struct {
	ID             int
	Name           string
	Description    string
	Position       int
	ModsOnlyTopics bool
}

func (s Section) URL() string {
	return "/forum/section/" + strconv.Itoa(s.ID)
}

// sectionSummary is a section of the forum home with its counters, counted by the query: they
// are not stored (_prd/forum/plan.md, «Данные»).
type sectionSummary struct {
	Section
	// TopicCount, PostCount and LastPost count only what a guest sees, for moderators too: posts
	// that are not deleted in topics that are not deleted.
	TopicCount int
	PostCount  int
	// LastPost is nil while the section has no visible post.
	LastPost *lastPost
	// Unread is whether a visible topic of the section is unread by the viewer; never for a guest.
	Unread bool
}

type lastPost struct {
	PostID     int
	TopicID    int
	TopicTitle string
	AuthorID   int
	AuthorName string
	At         time.Time
}

func (p lastPost) URL() string {
	return postURL(p.PostID)
}

func (p lastPost) TopicURL() string {
	return Topic{ID: p.TopicID}.URL()
}

// sections reads the sections of the home in one query, whatever the number of topics, with
// whether each has an unread topic (reads.go).
func (f *Forum) sections(ctx context.Context, v Viewer) ([]sectionSummary, error) {
	// A guest is user 0: no marks join and $1 > 0 skips the search for unread topics.
	rows, err := f.db.Query(ctx, `
		SELECT s.id, s.name, s.description, s.position, s.mods_only_topics,
		       (SELECT count(*) FROM forum_topics t WHERE t.section_id = s.id AND t.deleted_at IS NULL),
		       (SELECT count(*) FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id
		        WHERE t.section_id = s.id AND t.deleted_at IS NULL AND p.deleted_at IS NULL),
		       l.post_id, l.topic_id, l.title, l.author_id, l.author_name, l.at,
		       $1 > 0 AND EXISTS (
		           SELECT 1 FROM forum_topics t
		           LEFT JOIN forum_topic_reads r ON r.user_id = $1 AND r.topic_id = t.id
		           WHERE t.section_id = s.id AND t.deleted_at IS NULL AND t.last_post_at > $2
		             AND t.last_post_id > GREATEST(r.last_read_post_id, sm.post_id, fm.post_id, 0))
		FROM forum_sections s
		LEFT JOIN forum_read_marks sm ON sm.user_id = $1 AND sm.section_id = s.id
		LEFT JOIN forum_read_marks fm ON fm.user_id = $1 AND fm.section_id IS NULL
		LEFT JOIN LATERAL (
			SELECT t.last_post_id AS post_id, t.id AS topic_id, t.title, u.id AS author_id, u.name AS author_name, t.last_post_at AS at
			FROM forum_topics t
			JOIN forum_posts p ON p.id = t.last_post_id
			JOIN users u ON u.id = p.author_id
			WHERE t.section_id = s.id AND t.deleted_at IS NULL
			ORDER BY t.last_post_at DESC, t.id DESC
			LIMIT 1
		) l ON true
		ORDER BY s.position, s.id`, v.ID, v.RegisteredAt)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (sectionSummary, error) {
		var s sectionSummary
		var postID, topicID, authorID *int
		var title, author *string
		var at *time.Time
		err := row.Scan(&s.ID, &s.Name, &s.Description, &s.Position, &s.ModsOnlyTopics,
			&s.TopicCount, &s.PostCount, &postID, &topicID, &title, &authorID, &author, &at, &s.Unread)
		if postID != nil {
			s.LastPost = &lastPost{PostID: *postID, TopicID: *topicID, TopicTitle: *title, AuthorID: *authorID, AuthorName: *author, At: *at}
		}
		return s, err
	})
}

type homeData struct {
	view
	Sections []sectionSummary
	// Badge is the counter of unread notifications on the button «Notifications» (Badge).
	Badge string
}

func (f *Forum) home(w http.ResponseWriter, r *http.Request, v view) {
	sections, err := f.sections(r.Context(), v.Viewer)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := homeData{view: v, Sections: sections}
	if v.Viewer.SignedIn() {
		// As in the nav: without the counter the page still serves.
		n, err := f.UnreadNotifications(r.Context(), v.Viewer.ID)
		if err != nil {
			f.host.LogError(r, err)
		}
		data.Badge = Badge(n)
	}
	f.render(w, r, http.StatusOK, "home.html", data, Page{
		Title:       i18n.T(data.Lang, "forum.sections.title"),
		Description: i18n.T(data.Lang, "forum.sections.description"),
		Canonical:   f.baseURL + "/forum/",
	})
}

// loadSection reads the section and the number of its topics the viewer sees; pgx.ErrNoRows for
// a section that does not exist.
func (f *Forum) loadSection(ctx context.Context, id int, v Viewer) (Section, int, error) {
	var s Section
	var topics int
	err := f.db.QueryRow(ctx, `
		SELECT s.id, s.name, s.description, s.position, s.mods_only_topics,
		       (SELECT count(*) FROM forum_topics t
		        WHERE t.section_id = s.id AND ($2 OR t.deleted_at IS NULL))
		FROM forum_sections s
		WHERE s.id = $1`, id, v.Moderator).
		Scan(&s.ID, &s.Name, &s.Description, &s.Position, &s.ModsOnlyTopics, &topics)
	return s, topics, err
}

// topicRow is a topic of the section page.
type topicRow struct {
	Topic
	AuthorName string
	// LastAuthorName is empty and LastAuthorID 0 when every post of the topic is deleted.
	LastAuthorID   int
	LastAuthorName string
	SectionName    string
	// PostCount counts the deleted posts too, as the pages of the topic do.
	PostCount int
	// Unread is never true for a guest (reads.go).
	Unread bool
}

// Pages link the pages of a long topic from its row: all of them up to four, else the first and
// the last two ("1 … 6 7"); none for a topic of one page.
func (t topicRow) Pages() []pageLink {
	total := pageCount(t.PostCount, postsPerPage)
	if total < 2 {
		return nil
	}
	var links []pageLink
	for n := 1; n <= total; n++ {
		if total > 4 && n > 1 && n < total-1 {
			if n == 2 {
				links = append(links, pageLink{Gap: true})
			}
			continue
		}
		links = append(links, pageLink{Number: n, URL: pageURL(t.URL(), n)})
	}
	return links
}

func (t topicRow) LastPostURL() string {
	if t.LastPostID == nil {
		return ""
	}
	return postURL(*t.LastPostID)
}

// sectionTopics reads one page of the section in one query: pinned first, then by last activity,
// as the index forum_topics_section_activity_idx orders them. Deleted topics only for moderators.
// The viewer's marks come in the same query: whether a topic is unread (reads.go).
func (f *Forum) sectionTopics(ctx context.Context, sectionID, page int, v Viewer) ([]topicRow, error) {
	return f.topicRows(ctx, "t.section_id = $1", "t.pinned DESC, t.last_post_at DESC, t.id DESC", sectionID, page, topicsPerPage, v)
}

// topicRows reads one page of topics as the rows of a section show them, those of where (on $1, the
// id the list is of) in order. Deleted topics only for whoever reads them (CanReadTopic).
func (f *Forum) topicRows(ctx context.Context, where, order string, id, page, perPage int, v Viewer) ([]topicRow, error) {
	// A guest is user 0: no marks join and $5 > 0 keeps every topic read.
	rows, err := f.db.Query(ctx, `
		SELECT t.id, t.section_id, t.author_id, t.title, t.pinned, t.closed, t.created_at, t.deleted_at,
		       t.reply_count, t.last_post_id, t.last_post_at, a.name, lu.id, lu.name, s.name,
		       (SELECT count(*) FROM forum_posts p WHERE p.topic_id = t.id),
		       COALESCE($5 > 0 AND t.last_post_at > $6
		                AND t.last_post_id > GREATEST(r.last_read_post_id, sm.post_id, fm.post_id, 0), false)
		FROM forum_topics t
		JOIN users a ON a.id = t.author_id
		JOIN forum_sections s ON s.id = t.section_id
		LEFT JOIN forum_posts lp ON lp.id = t.last_post_id
		LEFT JOIN users lu ON lu.id = lp.author_id
		LEFT JOIN forum_topic_reads r ON r.user_id = $5 AND r.topic_id = t.id
		LEFT JOIN forum_read_marks sm ON sm.user_id = $5 AND sm.section_id = t.section_id
		LEFT JOIN forum_read_marks fm ON fm.user_id = $5 AND fm.section_id IS NULL
		WHERE `+where+` AND ($2 OR t.deleted_at IS NULL)
		ORDER BY `+order+`
		LIMIT $3 OFFSET $4`, id, v.CanReadTopic(Topic{DeletedAt: &time.Time{}}), perPage, (page-1)*perPage, v.ID, v.RegisteredAt)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (topicRow, error) {
		var t topicRow
		var lastAuthorID *int
		var lastAuthor *string
		err := row.Scan(&t.ID, &t.SectionID, &t.AuthorID, &t.Title, &t.Pinned, &t.Closed, &t.CreatedAt,
			&t.DeletedAt, &t.ReplyCount, &t.LastPostID, &t.LastPostAt, &t.AuthorName, &lastAuthorID, &lastAuthor,
			&t.SectionName, &t.PostCount, &t.Unread)
		if lastAuthor != nil {
			t.LastAuthorID, t.LastAuthorName = *lastAuthorID, *lastAuthor
		}
		return t, err
	})
}

// topicLine is the dot of the template "forum-topic-row": a row of a section, or of the tab
// «Topics» of a user page, which names the section of the topic instead of its author.
type topicLine struct {
	view
	Row       topicRow
	BySection bool
}

type sectionData struct {
	view
	Section    Section
	Topics     []topicRow
	Pagination pagination
}

// TopicLine is a row of the section: {{template "forum-topic-row" ($.TopicLine .)}}.
func (d sectionData) TopicLine(t topicRow) topicLine {
	return topicLine{view: d.view, Row: t}
}

func (f *Forum) section(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	page, pageOK := pageParam(r)
	if !ok || !pageOK {
		f.host.NotFound(w, r)
		return
	}
	s, count, err := f.loadSection(r.Context(), id, v.Viewer)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	pages := pageCount(count, topicsPerPage)
	if page > pages {
		f.host.NotFound(w, r)
		return
	}
	topics, err := f.sectionTopics(r.Context(), id, page, v.Viewer)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := sectionData{
		view:       v,
		Section:    s,
		Topics:     topics,
		Pagination: pagination{Lang: v.Lang, Path: s.URL(), Current: page, Total: pages},
	}
	f.render(w, r, http.StatusOK, "section.html", data, Page{
		Title:       pageTitle(v.Lang, s.Name, page),
		Description: s.Description,
		Canonical:   f.baseURL + pageURL(s.URL(), page),
	})
}
