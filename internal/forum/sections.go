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
	// ParentID is 0 for a section of the top level; a subsection has no subsections of its own
	// (_prd/forum/subsections). ParentName is the parent's, for the breadcrumbs.
	ParentID   int
	ParentName string
}

func (s Section) URL() string {
	return "/forum/section/" + strconv.Itoa(s.ID)
}

func (s Section) ParentURL() string {
	return Section{ID: s.ParentID}.URL()
}

// sectionColumns are the columns of Section, in its order, of forum_sections s joined to its
// parent ps: LEFT JOIN forum_sections ps ON ps.id = s.parent_id.
const sectionColumns = `s.id, s.name, s.description, s.position, s.mods_only_topics,
	COALESCE(s.parent_id, 0), COALESCE(ps.name, '')`

// treeOrder puts the sections of forum_sections s joined to its parent ps in the order of the home:
// each top section by position, its subsections by position right under it.
const treeOrder = `COALESCE(ps.position, s.position), COALESCE(ps.id, s.id), s.parent_id IS NOT NULL, s.position, s.id`

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
	// A parent's is of its whole family, in both of its faces.
	Unread bool
	// Children are the subsections of a parent of the home, in order; none on a parent page.
	Children []sectionSummary
	// Family is what a folded parent shows: its counters with those of its subsections, the newest
	// last post among them. An unfolded one shows its own; its subsections stand under it.
	Family family
	// Folded: the reader folded this parent on the home (fold.go); its subsections hide too.
	Folded bool
}

type family struct {
	TopicCount int
	PostCount  int
	LastPost   *lastPost
}

// gather counts the family of a parent from its own counters and its children's.
func (s *sectionSummary) gather() {
	s.Family = family{TopicCount: s.TopicCount, PostCount: s.PostCount, LastPost: s.LastPost}
	for _, c := range s.Children {
		s.Family.TopicCount += c.TopicCount
		s.Family.PostCount += c.PostCount
		s.Unread = s.Unread || c.Unread
		// The order of the query of a section's last post: the newest, a tie by topic id.
		if l, best := c.LastPost, s.Family.LastPost; l != nil &&
			(best == nil || l.At.After(best.At) || l.At.Equal(best.At) && l.TopicID > best.TopicID) {
			s.Family.LastPost = l
		}
	}
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
// whether each has an unread topic (reads.go): the top level, each parent with its subsections in
// Children and the counters of its family.
func (f *Forum) sections(ctx context.Context, v Viewer) ([]sectionSummary, error) {
	rows, err := f.sectionSummaries(ctx, v, 0)
	if err != nil {
		return nil, err
	}
	var top []sectionSummary
	place := map[int]int{}
	for _, s := range rows {
		if i, ok := place[s.ParentID]; ok {
			top[i].Children = append(top[i].Children, s)
			continue
		}
		place[s.ID] = len(top)
		top = append(top, s)
	}
	for i := range top {
		top[i].gather()
	}
	return top, nil
}

// sectionSummaries reads sections with their own counters in the order of the home: all of them
// for parent 0, else the subsections of that parent.
func (f *Forum) sectionSummaries(ctx context.Context, v Viewer, parent int) ([]sectionSummary, error) {
	// A guest is user 0: no marks join and $1 > 0 skips the search for unread topics.
	rows, err := f.db.Query(ctx, `
		SELECT `+sectionColumns+`,
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
		LEFT JOIN forum_sections ps ON ps.id = s.parent_id
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
		WHERE $3 = 0 OR s.parent_id = $3
		ORDER BY `+treeOrder, v.ID, v.RegisteredAt, parent)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (sectionSummary, error) {
		var s sectionSummary
		var postID, topicID, authorID *int
		var title, author *string
		var at *time.Time
		err := row.Scan(&s.ID, &s.Name, &s.Description, &s.Position, &s.ModsOnlyTopics, &s.ParentID, &s.ParentName,
			&s.TopicCount, &s.PostCount, &postID, &topicID, &title, &authorID, &author, &at, &s.Unread)
		if postID != nil {
			s.LastPost = &lastPost{PostID: *postID, TopicID: *topicID, TopicTitle: *title, AuthorID: *authorID, AuthorName: *author, At: *at}
		}
		return s, err
	})
}

// sectionLast is the dot of the template "forum-section-last": a section's last post, nil for none.
type sectionLast struct {
	view
	Post *lastPost
}

// SectionLast: {{template "forum-section-last" ($.SectionLast .LastPost)}}.
func (v view) SectionLast(p *lastPost) sectionLast {
	return sectionLast{view: v, Post: p}
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
	folded := foldedFromRequest(r)
	for i := range sections {
		p := &sections[i]
		p.Folded = len(p.Children) > 0 && folded[p.ID]
		for j := range p.Children {
			p.Children[j].Folded = p.Folded
		}
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

// sectionHead is a section page's section with what its page counts.
type sectionHead struct {
	Section
	// Topics is the number of its topics the viewer sees.
	Topics int
	// Subsections is the number of its subsections: a parent's page lists them above its topics.
	Subsections int
}

// loadSection reads the section with its parent's name and what its page counts; pgx.ErrNoRows for
// a section that does not exist.
func (f *Forum) loadSection(ctx context.Context, id int, v Viewer) (sectionHead, error) {
	var s sectionHead
	err := f.db.QueryRow(ctx, `
		SELECT `+sectionColumns+`,
		       (SELECT count(*) FROM forum_topics t
		        WHERE t.section_id = s.id AND ($2 OR t.deleted_at IS NULL)),
		       (SELECT count(*) FROM forum_sections c WHERE c.parent_id = s.id)
		FROM forum_sections s
		LEFT JOIN forum_sections ps ON ps.id = s.parent_id
		WHERE s.id = $1`, id, v.Moderator).
		Scan(&s.ID, &s.Name, &s.Description, &s.Position, &s.ModsOnlyTopics, &s.ParentID, &s.ParentName,
			&s.Topics, &s.Subsections)
	return s, err
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
	Section Section
	// Parent: the section has subsections. Children are they, on its first page only; a parent
	// without topics of its own shows no list of topics, not even «no topics».
	Parent     bool
	Children   []sectionSummary
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
	s, err := f.loadSection(r.Context(), id, v.Viewer)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	pages := pageCount(s.Topics, topicsPerPage)
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
		Section:    s.Section,
		Parent:     s.Subsections > 0,
		Topics:     topics,
		Pagination: pagination{Lang: v.Lang, Path: s.URL(), Current: page, Total: pages},
	}
	if data.Parent && page == 1 {
		if data.Children, err = f.sectionSummaries(r.Context(), v.Viewer, s.ID); err != nil {
			f.host.ServerError(w, r, err)
			return
		}
	}
	f.render(w, r, http.StatusOK, "section.html", data, Page{
		Title:       pageTitle(v.Lang, s.Name, page),
		Description: s.Description,
		Canonical:   f.baseURL + pageURL(s.URL(), page),
	})
}
