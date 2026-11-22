package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newSubsection(t *testing.T, db *pgxpool.Pool, name string, parent int) int {
	t.Helper()
	var id int
	err := db.QueryRow(context.Background(), `
		INSERT INTO forum_sections (name, parent_id, position)
		VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM forum_sections WHERE parent_id = $2))
		RETURNING id`, name, parent).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// homeSection is a section of the home, a parent or a subsection of one.
func homeSection(t *testing.T, f *Forum, v Viewer, id int) sectionSummary {
	t.Helper()
	sections, err := f.sections(context.Background(), v)
	assert.NilError(t, err)
	for _, s := range sections {
		if s.ID == id {
			return s
		}
		for _, c := range s.Children {
			if c.ID == id {
				return c
			}
		}
	}
	t.Fatalf("no section %d on the home", id)
	return sectionSummary{}
}

func readerViewer(t *testing.T, f *Forum, userID int) Viewer {
	t.Helper()
	v, err := f.loadViewer(context.Background(), userID, f.now())
	assert.NilError(t, err)
	return v
}

// The home nests subsections under their parent in order; a parent keeps its own counters and last
// post and adds up its family's: the topics and posts of all, the newest last post among them.
func TestSubsectionsOnHome(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	alice := forumtest.User(t, db, "alice", at(0))
	parent := newSection(t, db, "sheets")
	second := newSubsection(t, db, "second", parent)
	first := newSubsection(t, db, "first", parent)
	_, err := db.Exec(context.Background(), `UPDATE forum_sections SET position = 0 WHERE id = $1`, first)
	assert.NilError(t, err)

	own, _ := mustCreateTopic(t, f, parent, alice, "own", at(1))
	mustReply(t, f, own, alice, "reply", at(2))
	mustCreateTopic(t, f, first, alice, "in first", at(3))
	_, newest := mustCreateTopic(t, f, second, alice, "in second", at(5))
	gone, _ := mustCreateTopic(t, f, second, alice, "deleted", at(9))
	deleteTopic(t, db, gone)

	sections, err := f.sections(context.Background(), Viewer{})
	assert.NilError(t, err)
	for _, s := range sections {
		if s.ID == first || s.ID == second {
			t.Errorf("subsection %d at the top level", s.ID)
		}
	}
	p := homeSection(t, f, Viewer{}, parent)
	assert.Equal(t, len(p.Children), 2)
	assert.Equal(t, p.Children[0].ID, first)
	assert.Equal(t, p.Children[1].ID, second)
	assert.Equal(t, p.Children[0].ParentID, parent)
	assert.Equal(t, fmt.Sprint(p.TopicCount, p.PostCount, p.LastPost.TopicID), fmt.Sprint(1, 2, own))
	assert.Equal(t, fmt.Sprint(p.Family.TopicCount, p.Family.PostCount, p.Family.LastPost.PostID), fmt.Sprint(3, 4, newest))
	assert.Equal(t, fmt.Sprint(p.Children[1].TopicCount, p.Children[1].PostCount), fmt.Sprint(1, 1))

	// A section without subsections has the family of itself.
	lone := homeSection(t, f, Viewer{}, newSection(t, db, "lone"))
	assert.Equal(t, fmt.Sprint(lone.Family.TopicCount, lone.Family.LastPost), fmt.Sprint(0, nil))

	// Only the parent lists its subsections, above its topics, on its first page.
	h := &testHost{}
	g := newTestForum(t, db, h)
	h.get(t, g, Section{ID: parent}.URL())
	body := string(h.page.Body)
	assert.Equal(t, strings.Count(body, `href="`+Section{ID: first}.URL()+`"`), 1)
	assert.Equal(t, strings.Count(body, `class="forum-list-title"`), 2)
	h.get(t, g, Section{ID: first}.URL())
	assert.Equal(t, strings.Contains(string(h.page.Body), `class="forum-list-title"`), false)
}

// A parent without topics of its own shows its subsections and no list of topics, not even the
// line that there are none; a subsection's page and its topic's name the parent in the breadcrumbs.
func TestSubsectionPages(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	parent := newSection(t, db, "sheets")
	child := newSubsection(t, db, "bc", parent)
	topic, _ := mustCreateTopic(t, f, child, alice, "in child", at(1))

	h.get(t, f, Section{ID: parent}.URL())
	body := string(h.page.Body)
	assert.StringContains(t, body, `href="`+Section{ID: child}.URL()+`"`)
	assert.Equal(t, strings.Contains(body, `forum-empty`), false)
	assert.Equal(t, strings.Contains(body, `<ol class="forum-list forum-topics">`), false)

	crumb := regexp.MustCompile(`<nav class="forum-breadcrumbs">.*</nav>`)
	parentLink := `<a href="` + Section{ID: parent}.URL() + `">sheets</a>`
	for _, target := range []string{Section{ID: child}.URL(), Topic{ID: topic}.URL(), Section{ID: child}.URL() + "/new"} {
		h.userID = alice
		h.get(t, f, target)
		assert.Equal(t, h.status, http.StatusOK)
		assert.StringContains(t, crumb.FindString(string(h.page.Body)), parentLink)
	}
	// A section of the top level has no parent in its breadcrumbs.
	h.get(t, f, Section{ID: parent}.URL())
	assert.Equal(t, strings.Contains(crumb.FindString(string(h.page.Body)), parentLink), false)
}

// A parent is unread when anything in its family is; a subsection only from its own topics.
// «Mark as read» of a parent marks its subsections, of a subsection leaves its siblings.
func TestSubsectionsUnread(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	reader := forumtest.User(t, db, "reader", at(0))
	parent := newSection(t, db, "sheets")
	child := newSubsection(t, db, "bc", parent)
	sibling := newSubsection(t, db, "pf", parent)
	mustCreateTopic(t, f, child, alice, "news", at(1))

	unreadOf := func(id int) bool { return homeSection(t, f, readerViewer(t, f, reader), id).Unread }
	assert.Equal(t, unreadOf(parent), true)
	assert.Equal(t, unreadOf(child), true)
	assert.Equal(t, unreadOf(sibling), false)

	mustCreateTopic(t, f, sibling, alice, "more", at(2))
	h.userID = reader
	redirectedTo(t, h.post(t, f, Section{ID: child}.URL()+"/read", url.Values{}))
	assert.Equal(t, unreadOf(child), false)
	assert.Equal(t, unreadOf(sibling), true)
	assert.Equal(t, unreadOf(parent), true)

	mustCreateTopic(t, f, child, alice, "again", at(3))
	mustCreateTopic(t, f, parent, alice, "own", at(4))
	redirectedTo(t, h.post(t, f, Section{ID: parent}.URL()+"/read", url.Values{}))
	for _, id := range []int{parent, child, sibling} {
		assert.Equal(t, unreadOf(id), false)
	}
	// The folded parent's line of subsections marks the unread one.
	mustCreateTopic(t, f, sibling, alice, "late", at(5))
	h.get(t, f, "/forum/")
	line := regexp.MustCompile(`<span class="forum-subsections when-folded">.*?</span>\s*</div>`).FindString(string(h.page.Body))
	assert.StringContains(t, line, `<a href="`+Section{ID: sibling}.URL()+`" class="unread"`)
	assert.StringContains(t, line, `<a href="`+Section{ID: child}.URL()+`">`)
}

// Sections nest one level deep: a subsection cannot become a parent, nor a parent a subsection, nor
// a section its own parent; the form comes back with 422 and the error under the field, nothing
// changes and the log stays empty.
func TestSubsectionNestingRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	h.userID = newModerator(t, db, "mod")
	parent := newSection(t, db, "sheets")
	child := newSubsection(t, db, "bc", parent)
	other := newSection(t, db, "rules")
	before := fmt.Sprint(sectionTree(t, f))

	for _, tt := range []struct {
		target string
		form   url.Values
	}{
		{sectionsURL + "/new", url.Values{"name": {"deep"}, "parent": {fmt.Sprint(child)}}},
		{sectionEditURL(other), url.Values{"name": {"rules"}, "parent": {fmt.Sprint(child)}}},
		{sectionEditURL(parent), url.Values{"name": {"sheets"}, "parent": {fmt.Sprint(other)}}},
		{sectionEditURL(other), url.Values{"name": {"rules"}, "parent": {fmt.Sprint(other)}}},
		{sectionsURL + "/new", url.Values{"name": {"nowhere"}, "parent": {"999999"}}},
		{sectionsURL + "/new", url.Values{"name": {"nowhere"}, "parent": {"x"}}},
	} {
		h.post(t, f, tt.target, tt.form)
		assert.Equal(t, h.status, http.StatusUnprocessableEntity)
		assert.StringContains(t, string(h.page.Body), `id="forum-section-parent-error"`)
	}
	assert.Equal(t, fmt.Sprint(sectionTree(t, f)), before)
	assert.Equal(t, len(modLog(t, db)), 0)

	// The parent's field is off; a subsection's offers the top level but no subsection.
	h.get(t, f, sectionEditURL(parent))
	assert.StringContains(t, string(h.page.Body), `id="forum-section-parent-note"`)
	h.get(t, f, sectionEditURL(child))
	body := string(h.page.Body)
	assert.Equal(t, strings.Contains(body, `id="forum-section-parent-note"`), false)
	assert.StringContains(t, body, fmt.Sprintf(`<option value="%d" selected>`, parent))
	assert.Equal(t, strings.Contains(body, fmt.Sprintf(`<option value="%d"`, child)), false)
	// «+ Subsection» comes with the parent chosen.
	h.get(t, f, sectionsURL+"/new?parent="+fmt.Sprint(other))
	assert.StringContains(t, string(h.page.Body), fmt.Sprintf(`<option value="%d" selected>`, other))
}

// sectionTree is every section as "id:parent" in the order of the home.
func sectionTree(t *testing.T, f *Forum) []string {
	t.Helper()
	sections, err := f.sectionList(context.Background())
	assert.NilError(t, err)
	tree := make([]string, len(sections))
	for i, s := range sections {
		tree[i] = fmt.Sprintf("%d:%d", s.ID, s.ParentID)
	}
	return tree
}

// A subsection moves to another parent and to the top level with its topics, last among its new
// siblings each time; the log keeps where it was and where it went.
func TestMoveSubsection(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	mod := newModerator(t, db, "mod")
	h.userID = mod
	alice := forumtest.User(t, db, "alice", at(0))
	parent := newSection(t, db, "sheets")
	child := newSubsection(t, db, "bc", parent)
	other := newSection(t, db, "rules")
	stays := newSubsection(t, db, "stays", other)
	topic, _ := mustCreateTopic(t, f, child, alice, "topic", at(1))

	assert.Equal(t, redirectedTo(t, h.post(t, f, sectionEditURL(child), url.Values{"name": {"bc"}, "parent": {fmt.Sprint(other)}})), sectionsURL)
	s, err := f.loadSectionByID(context.Background(), child)
	assert.NilError(t, err)
	assert.Equal(t, fmt.Sprint(s.ParentID, s.ParentName), fmt.Sprint(other, "rules"))
	kids := homeSection(t, f, Viewer{}, other).Children
	assert.Equal(t, fmt.Sprint(kids[0].ID, kids[1].ID), fmt.Sprint(stays, child))
	assert.Equal(t, kids[1].TopicCount, 1)
	tp, err := f.loadTopic(context.Background(), topic, 0)
	assert.NilError(t, err)
	assert.Equal(t, tp.SectionID, child)

	redirectedTo(t, h.post(t, f, sectionEditURL(child), url.Values{"name": {"bc"}, "parent": {""}}))
	tree := sectionTree(t, f)
	assert.Equal(t, tree[len(tree)-1], fmt.Sprintf("%d:0", child))
	sections, err := f.sections(context.Background(), Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, sections[len(sections)-1].ID, child)

	log := modLog(t, db)
	assert.Equal(t, len(log), 2)
	assert.Equal(t, fmt.Sprint(log[0].Data["parent"], log[0].Data["parentTo"]), fmt.Sprint(float64(parent), float64(other)))
	assert.Equal(t, fmt.Sprint(log[1].Data["parent"], log[1].Data["parentTo"]), fmt.Sprint(float64(other), float64(0)))
	lines, err := f.logLines(context.Background(), 0, 10, 0)
	assert.NilError(t, err)
	assert.Equal(t, fmt.Sprint(lines[0].ParentMoved, lines[0].FromParent, lines[0].ToParent), fmt.Sprint(true, "rules", ""))
	assert.Equal(t, fmt.Sprint(lines[1].ParentMoved, lines[1].FromParent, lines[1].ToParent), fmt.Sprint(true, "sheets", "rules"))

	// An edit that keeps the parent writes no "parent"; a new subsection goes last inside its parent.
	redirectedTo(t, h.post(t, f, sectionEditURL(stays), url.Values{"name": {"renamed"}, "parent": {fmt.Sprint(other)}}))
	_, moved := modLog(t, db)[2].Data["parent"]
	assert.Equal(t, moved, false)
	redirectedTo(t, h.post(t, f, sectionsURL+"/new", url.Values{"name": {"new"}, "parent": {fmt.Sprint(other)}}))
	kids = homeSection(t, f, Viewer{}, other).Children
	assert.Equal(t, fmt.Sprint(len(kids), kids[1].Name), fmt.Sprint(2, "new"))
}

// Up and Down move a subsection among its siblings only: the first goes no higher, out of its
// parent neither; the top level keeps its order.
func TestMoveSubsectionAmongSiblings(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	h.userID = newModerator(t, db, "mod")
	parent := newSection(t, db, "sheets")
	a := newSubsection(t, db, "a", parent)
	b := newSubsection(t, db, "b", parent)
	before := sectionTree(t, f)

	redirectedTo(t, h.post(t, f, sectionMoveURL(a), url.Values{"direction": {"up"}}))
	redirectedTo(t, h.post(t, f, sectionMoveURL(b), url.Values{"direction": {"down"}}))
	assert.Equal(t, fmt.Sprint(sectionTree(t, f)), fmt.Sprint(before))
	assert.Equal(t, len(modLog(t, db)), 0)

	redirectedTo(t, h.post(t, f, sectionMoveURL(b), url.Values{"direction": {"up"}}))
	kids := homeSection(t, f, Viewer{}, parent).Children
	assert.Equal(t, fmt.Sprint(kids[0].ID, kids[1].ID), fmt.Sprint(b, a))
	log := modLog(t, db)
	assert.Equal(t, fmt.Sprint(log[0].Data["from"], log[0].Data["to"]), fmt.Sprint(float64(2), float64(1)))
	tops := func(tree []string) (out []string) {
		for _, s := range tree {
			if strings.HasSuffix(s, ":0") {
				out = append(out, s)
			}
		}
		return out
	}
	assert.Equal(t, fmt.Sprint(tops(sectionTree(t, f))), fmt.Sprint(tops(before)))

	// The list of sections: the ends of each run of siblings have no button to go past them.
	h.get(t, f, sectionsURL)
	body := string(h.page.Body)
	assert.StringContains(t, body, fmt.Sprintf(`/forum/mod/sections/new?parent=%d`, parent))
	assert.Equal(t, strings.Contains(body, fmt.Sprintf(`/forum/mod/sections/new?parent=%d"`, b)), false)
}

// The form of a new topic in a family offers its sections where the viewer may start one, the
// section of the page chosen; the topic goes where chosen. A section out of the family or one of
// moderators' topics for a member is refused under the field, and nothing is written.
func TestNewTopicInFamily(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	parent := newSection(t, db, "sheets")
	child := newSubsection(t, db, "bc", parent)
	news := newSubsection(t, db, "news", parent)
	_, err := db.Exec(context.Background(), `UPDATE forum_sections SET mods_only_topics = true WHERE id = $1`, news)
	assert.NilError(t, err)
	stranger := newSection(t, db, "elsewhere")
	option := func(id int) string { return fmt.Sprintf(`<option value="%d"`, id) }

	h.userID = alice
	h.get(t, f, Section{ID: child}.URL()+"/new")
	body := string(h.page.Body)
	assert.StringContains(t, body, `id="forum-topic-section"`)
	assert.StringContains(t, body, fmt.Sprintf(`<option value="%d" selected>`, child))
	assert.StringContains(t, body, option(parent))
	assert.Equal(t, strings.Contains(body, option(news)), false)
	h.userID = mod
	h.get(t, f, Section{ID: parent}.URL()+"/new")
	assert.StringContains(t, string(h.page.Body), option(news))
	// A section without a family has no choice.
	h.get(t, f, Section{ID: stranger}.URL()+"/new")
	assert.Equal(t, strings.Contains(string(h.page.Body), `id="forum-topic-section"`), false)

	h.userID = alice
	topics, posts := countRows(t, db)
	for _, section := range []int{stranger, news, 999999} {
		h.post(t, f, Section{ID: parent}.URL()+"/new", url.Values{"title": {"a topic"}, "body": {"text"}, "section": {fmt.Sprint(section)}})
		assert.Equal(t, h.status, http.StatusUnprocessableEntity)
		assert.StringContains(t, string(h.page.Body), `id="forum-topic-section-error"`)
	}
	t2, p2 := countRows(t, db)
	assert.Equal(t, fmt.Sprint(t2, p2), fmt.Sprint(topics, posts))

	redirectedTo(t, h.post(t, f, Section{ID: parent}.URL()+"/new", url.Values{"title": {"a topic"}, "body": {"text"}, "section": {fmt.Sprint(child)}}))
	_, topicID, _, _ := newestPost(t, db)
	tp, err := f.loadTopic(context.Background(), topicID, 0)
	assert.NilError(t, err)
	assert.Equal(t, tp.SectionID, child)
}

// The fold arrow turns its section over in the cookie and leaves the others; ids of sections that
// no longer exist are dropped, and with nothing folded the cookie goes. A guest folds too.
func TestSetFold(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	a := newSection(t, db, "a")
	b := newSection(t, db, "b")

	fold := func(cookie string, section string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/forum/view/fold", strings.NewReader(url.Values{"section": {section}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: foldedCookie, Value: cookie})
		}
		rec := httptest.NewRecorder()
		f.Handler().ServeHTTP(rec, req)
		return rec
	}
	for _, tt := range []struct {
		name, cookie string
		section      int
		want         string
	}{
		{"fold", "", a, fmt.Sprint(a)},
		{"fold another", fmt.Sprint(a), b, fmt.Sprintf("%d,%d", a, b)},
		{"unfold one", fmt.Sprintf("%d,%d", a, b), a, fmt.Sprint(b)},
		{"drop what is gone", fmt.Sprintf("999999,junk,%d", b), a, fmt.Sprintf("%d,%d", a, b)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := fold(tt.cookie, fmt.Sprint(tt.section))
			assert.Equal(t, redirectedTo(t, rec), fmt.Sprintf("/forum/#section-%d", tt.section))
			cookies := rec.Result().Cookies()
			assert.Equal(t, len(cookies), 1)
			assert.Equal(t, fmt.Sprint(cookies[0].Name, cookies[0].Value, cookies[0].Path), fmt.Sprint(foldedCookie, tt.want, "/forum"))
			assert.Equal(t, cookies[0].MaxAge, 365*24*60*60)
		})
	}
	rec := fold(fmt.Sprint(a), fmt.Sprint(a))
	c := rec.Result().Cookies()[0]
	if c.MaxAge >= 0 {
		t.Errorf("MaxAge %d, want the cookie deleted", c.MaxAge)
	}
	assert.Equal(t, fold("", "x").Code, http.StatusBadRequest)
}

// The home renders a folded parent and its subsections with the class folded, from the cookie: the
// page needs no script to show it.
func TestHomeFolded(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	folded := newSection(t, db, "folded")
	newSubsection(t, db, "folded child", folded)
	open := newSection(t, db, "open")
	newSubsection(t, db, "open child", open)
	lone := newSection(t, db, "lone")

	classes := func(cookie string) map[string]string {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/forum/", nil)
		req.AddCookie(&http.Cookie{Name: foldedCookie, Value: cookie})
		f.Handler().ServeHTTP(httptest.NewRecorder(), req)
		assert.Equal(t, h.status, http.StatusOK)
		got := map[string]string{}
		re := regexp.MustCompile(`<li class="([^"]*)"[^>]*(data-section|data-parent)="(\d+)"`)
		for _, m := range re.FindAllStringSubmatch(string(h.page.Body), -1) {
			got[m[2]+m[3]] += m[1] + ";"
		}
		return got
	}
	got := classes(fmt.Sprintf("%d,%d", folded, lone))
	has := func(key string) bool { return strings.Contains(got[key], " folded") }
	assert.Equal(t, has(fmt.Sprint("data-section", folded)), true)
	assert.Equal(t, has(fmt.Sprint("data-parent", folded)), true)
	assert.Equal(t, has(fmt.Sprint("data-section", open)), false)
	assert.Equal(t, has(fmt.Sprint("data-parent", open)), false)
	// A section without subsections has no arrow, folded in the cookie or not.
	assert.Equal(t, strings.Contains(string(h.page.Body), fmt.Sprintf(`name="section" value="%d"`, lone)), false)
	assert.StringContains(t, string(h.page.Body), fmt.Sprintf(`name="section" value="%d"`, open))
	assert.StringContains(t, got[fmt.Sprint("data-parent", folded)], "forum-subrow")

	got = classes("")
	assert.Equal(t, has(fmt.Sprint("data-section", folded)), false)
}
