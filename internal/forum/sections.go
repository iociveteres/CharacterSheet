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
	// TopicCount and LastPost count only what a guest sees, for moderators too.
	TopicCount int
	// LastPost is nil while the section has no visible post.
	LastPost *lastPost
}

type lastPost struct {
	PostID     int
	TopicTitle string
	AuthorName string
	At         time.Time
}

func (p lastPost) URL() string {
	return postURL(p.PostID)
}

// sections reads the sections of the home in one query, whatever the number of topics.
func (f *Forum) sections(ctx context.Context) ([]sectionSummary, error) {
	rows, err := f.db.Query(ctx, `
		SELECT s.id, s.name, s.description, s.position, s.mods_only_topics,
		       (SELECT count(*) FROM forum_topics t WHERE t.section_id = s.id AND t.deleted_at IS NULL),
		       l.post_id, l.title, l.author_name, l.at
		FROM forum_sections s
		LEFT JOIN LATERAL (
			SELECT t.last_post_id AS post_id, t.title, u.name AS author_name, t.last_post_at AS at
			FROM forum_topics t
			JOIN forum_posts p ON p.id = t.last_post_id
			JOIN users u ON u.id = p.author_id
			WHERE t.section_id = s.id AND t.deleted_at IS NULL
			ORDER BY t.last_post_at DESC, t.id DESC
			LIMIT 1
		) l ON true
		ORDER BY s.position, s.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (sectionSummary, error) {
		var s sectionSummary
		var postID *int
		var title, author *string
		var at *time.Time
		err := row.Scan(&s.ID, &s.Name, &s.Description, &s.Position, &s.ModsOnlyTopics,
			&s.TopicCount, &postID, &title, &author, &at)
		if postID != nil {
			s.LastPost = &lastPost{PostID: *postID, TopicTitle: *title, AuthorName: *author, At: *at}
		}
		return s, err
	})
}

type homeData struct {
	view
	Sections []sectionSummary
}

func (f *Forum) home(w http.ResponseWriter, r *http.Request, v view) {
	sections, err := f.sections(r.Context())
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := homeData{view: v, Sections: sections}
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
	// LastAuthorName is empty when every post of the topic is deleted.
	LastAuthorName string
}

func (t topicRow) LastPostURL() string {
	if t.LastPostID == nil {
		return ""
	}
	return postURL(*t.LastPostID)
}

// sectionTopics reads one page of the section in one query: pinned first, then by last activity,
// as the index forum_topics_section_activity_idx orders them. Deleted topics only for moderators.
func (f *Forum) sectionTopics(ctx context.Context, sectionID, page int, v Viewer) ([]topicRow, error) {
	rows, err := f.db.Query(ctx, `
		SELECT t.id, t.section_id, t.author_id, t.title, t.pinned, t.closed, t.created_at, t.deleted_at,
		       t.reply_count, t.last_post_id, t.last_post_at, a.name, lu.name
		FROM forum_topics t
		JOIN users a ON a.id = t.author_id
		LEFT JOIN forum_posts lp ON lp.id = t.last_post_id
		LEFT JOIN users lu ON lu.id = lp.author_id
		WHERE t.section_id = $1 AND ($2 OR t.deleted_at IS NULL)
		ORDER BY t.pinned DESC, t.last_post_at DESC, t.id DESC
		LIMIT $3 OFFSET $4`, sectionID, v.Moderator, topicsPerPage, (page-1)*topicsPerPage)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (topicRow, error) {
		var t topicRow
		var lastAuthor *string
		err := row.Scan(&t.ID, &t.SectionID, &t.AuthorID, &t.Title, &t.Pinned, &t.Closed, &t.CreatedAt,
			&t.DeletedAt, &t.ReplyCount, &t.LastPostID, &t.LastPostAt, &t.AuthorName, &lastAuthor)
		if lastAuthor != nil {
			t.LastAuthorName = *lastAuthor
		}
		return t, err
	})
}

type sectionData struct {
	view
	Section    Section
	Topics     []topicRow
	Pagination pagination
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
		Title:       s.Name,
		Description: s.Description,
		Canonical:   f.baseURL + pageURL(s.URL(), page),
	})
}
