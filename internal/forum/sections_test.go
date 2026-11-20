package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync/atomic"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testHost signs in userID (0 is a guest) and keeps what the forum hands it instead of answering:
// the rendered page, a 404, a server error.
type testHost struct {
	userID   int
	err      error
	status   int
	page     Page
	notFound bool
	// logged is what the forum wrote to the error log and served the page after.
	logged []error
	// avatarURLs are the avatars Avatars answers with; avatarErr fails it instead. avatarCalls
	// counts its calls and avatarIDs keeps the users each asked for.
	avatarURLs  map[int]string
	avatarErr   error
	avatarCalls int
	avatarIDs   [][]int
	avatarLocks map[int]*AvatarLock
	removeErr   error
}

func (h *testHost) UserID(*http.Request) (int, bool) { return h.userID, h.userID != 0 }
func (h *testHost) CSRFToken(*http.Request) string   { return "" }
func (h *testHost) PutFlash(*http.Request, string)   {}
func (h *testHost) Render(_ http.ResponseWriter, _ *http.Request, status int, page Page) {
	h.status, h.page = status, page
}
func (h *testHost) NotFound(http.ResponseWriter, *http.Request) { h.notFound = true }
func (h *testHost) RedirectToLogin(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/user/login", http.StatusSeeOther)
}
func (h *testHost) LogError(_ *http.Request, err error) { h.logged = append(h.logged, err) }
func (h *testHost) ServerError(_ http.ResponseWriter, _ *http.Request, err error) {
	h.err = err
}
func (h *testHost) Avatars(_ context.Context, userIDs []int) (map[int]string, error) {
	h.avatarCalls++
	h.avatarIDs = append(h.avatarIDs, userIDs)
	if h.avatarErr != nil {
		return nil, h.avatarErr
	}
	urls := map[int]string{}
	for _, id := range userIDs {
		if url, ok := h.avatarURLs[id]; ok {
			urls[id] = url
		}
	}
	return urls, nil
}
func (h *testHost) AvatarState(_ context.Context, userID int) (AvatarState, error) {
	return AvatarState{URL: h.avatarURLs[userID], Lock: h.avatarLocks[userID]}, h.avatarErr
}

// RemoveAvatar and LiftAvatarLock change avatarURLs and avatarLocks as the site's model does;
// removeErr fails RemoveAvatar instead.
func (h *testHost) RemoveAvatar(_ context.Context, userID int, lock *AvatarLock) error {
	if h.removeErr != nil {
		return h.removeErr
	}
	delete(h.avatarURLs, userID)
	if lock != nil {
		if h.avatarLocks == nil {
			h.avatarLocks = map[int]*AvatarLock{}
		}
		l := *lock
		l.UserID = userID
		h.avatarLocks[userID] = &l
	}
	return nil
}
func (h *testHost) LiftAvatarLock(_ context.Context, userID int) error {
	delete(h.avatarLocks, userID)
	return nil
}
func (h *testHost) AvatarLocks(context.Context) ([]AvatarLock, error) {
	var locks []AvatarLock
	for _, l := range h.avatarLocks {
		locks = append(locks, *l)
	}
	sort.Slice(locks, func(i, j int) bool { return locks[i].UserID < locks[j].UserID })
	return locks, nil
}
func (h *testHost) AccountURL() string { return "/account/view#avatar" }

// get serves target to the viewer of the host; a server error fails the test.
func (h *testHost) get(t *testing.T, f *Forum, target string) *httptest.ResponseRecorder {
	t.Helper()
	h.err, h.status, h.page, h.notFound = nil, 0, Page{}, false
	rec := httptest.NewRecorder()
	f.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	if h.err != nil {
		t.Fatalf("GET %s: %v", target, h.err)
	}
	return rec
}

// found is whether the last get rendered a page rather than a 404.
func (h *testHost) found(t *testing.T, target string) bool {
	t.Helper()
	if h.notFound == (h.status != 0) {
		t.Fatalf("GET %s: status %d, not found %v", target, h.status, h.notFound)
	}
	return !h.notFound
}

func newTestForum(t *testing.T, db *pgxpool.Pool, host Host) *Forum {
	t.Helper()
	f, err := New(db, "https://example.com", host)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestSectionsByPosition(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()

	// The starting sections of the migration, then one moved to the top.
	sections, err := f.sections(ctx, Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, len(sections), 5)
	modsOnly := 0
	for i, s := range sections {
		assert.Equal(t, s.Position, i+1)
		if s.ModsOnlyTopics {
			modsOnly++
		}
	}
	assert.Equal(t, modsOnly, 1)
	assert.Equal(t, sections[0].ModsOnlyTopics, true)

	last := sections[4]
	if _, err := db.Exec(ctx, `UPDATE forum_sections SET position = 0 WHERE id = $1`, last.ID); err != nil {
		t.Fatal(err)
	}
	sections, err = f.sections(ctx, Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, sections[0].ID, last.ID)
	assert.Equal(t, sections[0].Name, last.Name)
	assert.Equal(t, sections[0].Description, last.Description)
}

func topicTitles(rows []topicRow) []string {
	titles := make([]string, len(rows))
	for i, r := range rows {
		titles[i] = r.Title
	}
	return titles
}

func TestSectionTopicsOrder(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	author := forumtest.User(t, db, "author", at(0))
	section := newSection(t, db, "section")

	ids := map[string]int{}
	for i, title := range []string{"a", "b", "c", "d"} {
		ids[title], _ = mustCreateTopic(t, f, section, author, title, at(i+1))
	}
	// A reply lifts the oldest topic above the others; a pinned one stays on top whatever its age.
	mustReply(t, f, ids["a"], author, "reply", at(10))
	if _, err := db.Exec(ctx, `UPDATE forum_topics SET pinned = true WHERE id = $1`, ids["b"]); err != nil {
		t.Fatal(err)
	}
	// Equal activity: the newer topic first, so pages never swap topics between requests.
	if _, err := db.Exec(ctx, `UPDATE forum_topics SET last_post_at = $1 WHERE id = ANY($2)`,
		at(5), []int{ids["c"], ids["d"]}); err != nil {
		t.Fatal(err)
	}

	rows, err := f.sectionTopics(ctx, section, 1, Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, strings.Join(topicTitles(rows), ","), "b,a,d,c")
	assert.Equal(t, rows[1].ReplyCount, 1)
	assert.Equal(t, rows[1].PostCount, 2)
	assert.Equal(t, rows[1].AuthorName, "author")
	assert.Equal(t, rows[1].LastAuthorName, "author")
}

func TestSectionPages(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	ctx := context.Background()
	author := forumtest.User(t, db, "author", at(0))
	moderator := newModerator(t, db, "moderator")
	section := newSection(t, db, "section")
	path := fmt.Sprintf("/forum/section/%d", section)

	found := func(viewer int, target string) bool {
		t.Helper()
		host.userID = viewer
		host.get(t, f, target)
		return host.found(t, target)
	}

	// An empty section has its first page.
	assert.Equal(t, found(0, path), true)
	assert.Equal(t, found(0, path+"?page=2"), false)

	var first int
	for i := 1; i <= 30; i++ {
		id, _ := mustCreateTopic(t, f, section, author, fmt.Sprintf("topic %02d", i), at(i))
		if i == 1 {
			first = id
		}
	}
	assert.Equal(t, found(0, path), true)
	assert.Equal(t, strings.Count(string(host.page.Body), `<li class="forum-row`), 30)
	assert.Equal(t, host.page.Canonical, "https://example.com"+path)
	assert.Equal(t, found(0, path+"?page=2"), false)

	// The 31st topic pushes the oldest to the second page.
	mustCreateTopic(t, f, section, author, "topic 31", at(31))
	assert.Equal(t, found(0, path+"?page=2"), true)
	assert.Equal(t, strings.Count(string(host.page.Body), `<li class="forum-row`), 1)
	assert.StringContains(t, string(host.page.Body), "topic 01")
	assert.Equal(t, host.page.Canonical, "https://example.com"+path+"?page=2")
	assert.Equal(t, found(0, path+"?page=3"), false)
	rows, err := f.sectionTopics(ctx, section, 2, Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, len(rows), 1)
	assert.Equal(t, rows[0].ID, first)

	// A deleted topic leaves the pages of guests and stays on those of moderators.
	deleteTopic(t, db, first)
	assert.Equal(t, found(0, path+"?page=2"), false)
	assert.Equal(t, found(moderator, path+"?page=2"), true)
	assert.StringContains(t, string(host.page.Body), "topic 01")

	// Anything but a positive integer is a page that does not exist.
	for _, page := range []string{"0", "-1", "abc", "", "1.5", "99999999999999999999"} {
		assert.Equal(t, found(0, path+"?page="+page), false)
	}
	assert.Equal(t, found(0, path+"?page=1"), true)
	assert.Equal(t, host.page.Canonical, "https://example.com"+path)
	assert.Equal(t, found(0, "/forum/section/999999"), false)
	assert.Equal(t, found(0, "/forum/section/abc"), false)
}

func TestHomeSectionCounters(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	section := newSection(t, db, "section")
	empty := newSection(t, db, "empty")

	old, _ := mustCreateTopic(t, f, section, alice, "old", at(1))
	newer, _ := mustCreateTopic(t, f, section, alice, "newer", at(2))
	deletePost(t, db, mustReply(t, f, newer, bob, "deleted reply", at(2)))
	lastReply := mustReply(t, f, old, bob, "reply", at(3))
	// Neither a deleted topic nor a topic whose posts are all deleted holds the last post.
	deleted, _ := mustCreateTopic(t, f, section, alice, "deleted", at(4))
	deleteTopic(t, db, deleted)
	_, emptied := mustCreateTopic(t, f, section, alice, "emptied", at(5))
	deletePost(t, db, emptied)

	sections, err := f.sections(ctx, Viewer{})
	assert.NilError(t, err)
	byID := map[int]sectionSummary{}
	for _, s := range sections {
		byID[s.ID] = s
	}
	got := byID[section]
	assert.Equal(t, got.TopicCount, 3)
	// Visible posts of visible topics: two in "old", the first of "newer".
	assert.Equal(t, got.PostCount, 3)
	if got.LastPost == nil {
		t.Fatal("no last post")
	}
	assert.Equal(t, got.LastPost.PostID, lastReply)
	assert.Equal(t, got.LastPost.TopicID, old)
	assert.Equal(t, got.LastPost.TopicTitle, "old")
	assert.Equal(t, got.LastPost.AuthorName, "bob")
	assert.Equal(t, got.LastPost.At.Equal(at(3)), true)
	assert.Equal(t, byID[empty].TopicCount, 0)
	assert.Equal(t, byID[empty].PostCount, 0)
	assert.Equal(t, byID[empty].LastPost == nil, true)
}

// queryCounter counts the queries of a pool: a page whose count grows with the number of topics
// or posts runs a query per row.
type queryCounter struct{ n atomic.Int64 }

func (c *queryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	c.n.Add(1)
	return ctx
}

func (c *queryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// Every page makes the same number of queries with a few topics, posts and authors as with many.
func TestPagesMakeConstantQueries(t *testing.T) {
	db := forumtest.NewDB(t)
	ctx := context.Background()
	// A second pool to the same schema, with the counter as its tracer.
	cfg := db.Config()
	counter := &queryCounter{}
	cfg.ConnConfig.Tracer = counter
	counted, err := pgxpool.NewWithConfig(ctx, cfg)
	assert.NilError(t, err)
	t.Cleanup(counted.Close)
	host := &testHost{}
	f := newTestForum(t, counted, host)
	write := newTestForum(t, db, &testHost{})

	moderator := newModerator(t, db, "moderator")
	// A participant with marks of a topic, a section and the forum: the lists read them in the
	// same query.
	reader := forumtest.User(t, db, "reader", at(0))
	section := newSection(t, db, "section")
	topic, firstPost := mustCreateTopic(t, write, section, moderator, "topic", at(0))
	assert.NilError(t, readTopicUpTo(ctx, db, reader, topic, firstPost, at(0)))
	assert.NilError(t, write.markRead(ctx, reader, &section))
	assert.NilError(t, write.markRead(ctx, reader, nil))
	targets := []string{
		"/forum/",
		fmt.Sprintf("/forum/section/%d", section),
		fmt.Sprintf("/forum/topic/%d", topic),
		fmt.Sprintf("/forum/topic/%d/unread", topic),
		fmt.Sprintf("/forum/post/%d", firstPost),
		"/forum/notifications",
	}
	queries := func() map[string]int64 {
		got := map[string]int64{}
		for _, viewer := range []int{0, moderator, reader} {
			host.userID = viewer
			for _, target := range targets {
				counter.n.Store(0)
				host.get(t, f, target)
				got[fmt.Sprintf("%s as %d", target, viewer)] = counter.n.Load()
			}
		}
		return got
	}

	few := queries()
	// Topics of their own authors in every section, posts of their own authors in the topic.
	for i := range 25 {
		author := forumtest.User(t, db, fmt.Sprintf("author %d", i), at(0))
		var id int
		err := db.QueryRow(ctx, `SELECT id FROM forum_sections ORDER BY id OFFSET $1 LIMIT 1`, i%5).Scan(&id)
		assert.NilError(t, err)
		mustCreateTopic(t, write, id, author, fmt.Sprintf("topic %d", i), at(i))
		mustCreateTopic(t, write, section, author, fmt.Sprintf("more %d", i), at(i))
		mustReply(t, write, topic, author, "reply", at(i))
	}
	many := queries()
	for target, n := range few {
		if many[target] != n {
			t.Errorf("%s: %d queries with a few topics, %d with many", target, n, many[target])
		}
	}
	t.Logf("queries: %v", many)
}
