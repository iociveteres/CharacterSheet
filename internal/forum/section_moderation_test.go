package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

func sectionEditURL(id int) string { return fmt.Sprintf("%s/%d/edit", sectionsURL, id) }
func sectionMoveURL(id int) string { return fmt.Sprintf("%s/%d/move", sectionsURL, id) }

// sectionIDs is every section in the order of the home.
func sectionIDs(t *testing.T, f *Forum) []int {
	t.Helper()
	sections, err := f.sectionList(context.Background())
	assert.NilError(t, err)
	ids := make([]int, len(sections))
	for i, s := range sections {
		ids[i] = s.ID
	}
	return ids
}

// A moderator creates a section, which goes last, and edits it; each writes its line of the log,
// the edit with what it replaced. A form that changes nothing writes nothing.
func TestCreateAndEditSection(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	mod := newModerator(t, db, "mod")
	h.userID = mod

	for _, target := range []string{sectionsURL, sectionsURL + "/new"} {
		h.get(t, f, target)
		assert.Equal(t, h.status, http.StatusOK)
		assert.Equal(t, h.page.NoIndex, true)
	}
	before := sectionIDs(t, f)

	form := url.Values{"name": {"  Rules  "}, "description": {" Read first. "}, "mods_only_topics": {"1"}}
	assert.Equal(t, redirectedTo(t, h.post(t, f, sectionsURL+"/new", form)), sectionsURL)
	after := sectionIDs(t, f)
	assert.Equal(t, len(after), len(before)+1)
	id := after[len(after)-1]
	s, err := f.loadSectionByID(context.Background(), id)
	assert.NilError(t, err)
	assert.Equal(t, fmt.Sprint(s), fmt.Sprint(Section{ID: id, Name: "Rules", Description: "Read first.", Position: len(after), ModsOnlyTopics: true}))
	log := modLog(t, db)
	assert.Equal(t, len(log), 1)
	assert.Equal(t, fmt.Sprint(log[0]), fmt.Sprint(logRow{ModeratorID: mod, Action: "section.create", SectionID: id, Data: map[string]any{}}))

	// The edit page holds what is stored; without the box ticked the rule is off.
	h.get(t, f, sectionEditURL(id))
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	assert.StringContains(t, string(h.page.Body), `value="Rules"`)
	assert.StringContains(t, string(h.page.Body), ` checked`)
	assert.Equal(t, redirectedTo(t, h.post(t, f, sectionEditURL(id), url.Values{"name": {"House rules"}})), sectionsURL)
	s, err = f.loadSectionByID(context.Background(), id)
	assert.NilError(t, err)
	assert.Equal(t, fmt.Sprint(s), fmt.Sprint(Section{ID: id, Name: "House rules", Position: len(after)}))
	log = modLog(t, db)
	assert.Equal(t, len(log), 2)
	assert.Equal(t, fmt.Sprint(log[1]), fmt.Sprint(logRow{ModeratorID: mod, Action: "section.edit", SectionID: id,
		Data: map[string]any{"name": "Rules", "description": "Read first.", "modsOnlyTopics": true}}))

	redirectedTo(t, h.post(t, f, sectionEditURL(id), url.Values{"name": {"House rules"}}))
	assert.Equal(t, len(modLog(t, db)), 2)
	// The home shows the new section.
	assert.Equal(t, sectionCounts(t, f, id).Name, "House rules")
}

// A name blank or too long, a description too long: the form comes back with 422 and the typed
// text, nothing is written.
func TestSectionFormErrors(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	h.userID = newModerator(t, db, "mod")
	id := sectionIDs(t, f)[0]
	before := sectionIDs(t, f)

	for _, tt := range []struct {
		form  url.Values
		field string
	}{
		{url.Values{"name": {" \t "}}, "name"},
		{url.Values{"name": {strings.Repeat("я", sectionNameMaxChars+1)}}, "name"},
		{url.Values{"name": {"name"}, "description": {strings.Repeat("я", sectionDescriptionMaxChars+1)}}, "description"},
	} {
		for _, target := range []string{sectionsURL + "/new", sectionEditURL(id)} {
			h.post(t, f, target, tt.form)
			assert.Equal(t, h.status, http.StatusUnprocessableEntity)
			page := string(h.page.Body)
			assert.StringContains(t, page, `id="forum-section-`+tt.field+`-error"`)
			if d := tt.form.Get("description"); d != "" {
				assert.StringContains(t, page, ">"+d+"</textarea>")
			}
		}
	}
	assert.Equal(t, fmt.Sprint(sectionIDs(t, f)), fmt.Sprint(before))
	assert.Equal(t, len(modLog(t, db)), 0)

	// The longest name and description pass, counted in characters.
	redirectedTo(t, h.post(t, f, sectionsURL+"/new", url.Values{
		"name":        {strings.Repeat("я", sectionNameMaxChars)},
		"description": {strings.Repeat("я", sectionDescriptionMaxChars)},
	}))
	assert.Equal(t, len(sectionIDs(t, f)), len(before)+1)
}

// Up and Down swap a section with its neighbour, also among tied positions; the first goes no
// higher and the last no lower, without a line in the log.
func TestMoveSection(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	mod := newModerator(t, db, "mod")
	h.userID = mod
	// Two sections of the same position, as newSection makes them.
	newSection(t, db, "tied a")
	newSection(t, db, "tied b")
	ids := sectionIDs(t, f)
	n := len(ids)

	second := ids[1]
	assert.Equal(t, redirectedTo(t, h.post(t, f, sectionMoveURL(second), url.Values{"direction": {"up"}})),
		fmt.Sprintf("%s#section-%d", sectionsURL, second))
	want := append([]int{second, ids[0]}, ids[2:]...)
	assert.Equal(t, fmt.Sprint(sectionIDs(t, f)), fmt.Sprint(want))
	log := modLog(t, db)
	assert.Equal(t, len(log), 1)
	assert.Equal(t, fmt.Sprint(log[0]), fmt.Sprint(logRow{ModeratorID: mod, Action: "section.move", SectionID: second,
		Data: map[string]any{"from": float64(2), "to": float64(1)}}))

	// The tied pair at the end swaps too.
	redirectedTo(t, h.post(t, f, sectionMoveURL(ids[n-2]), url.Values{"direction": {"down"}}))
	want[n-2], want[n-1] = want[n-1], want[n-2]
	assert.Equal(t, fmt.Sprint(sectionIDs(t, f)), fmt.Sprint(want))
	assert.Equal(t, len(modLog(t, db)), 2)

	// The ends stay.
	redirectedTo(t, h.post(t, f, sectionMoveURL(want[0]), url.Values{"direction": {"up"}}))
	redirectedTo(t, h.post(t, f, sectionMoveURL(want[n-1]), url.Values{"direction": {"down"}}))
	assert.Equal(t, fmt.Sprint(sectionIDs(t, f)), fmt.Sprint(want))
	assert.Equal(t, len(modLog(t, db)), 2)

	// No such section, no such direction.
	h.post(t, f, sectionMoveURL(999999), url.Values{"direction": {"up"}})
	assert.Equal(t, h.notFound, true)
	assert.Equal(t, h.post(t, f, sectionMoveURL(second), url.Values{"direction": {"left"}}).Code, http.StatusBadRequest)
	h.get(t, f, sectionEditURL(999999))
	assert.Equal(t, h.notFound, true)
	assert.Equal(t, len(modLog(t, db)), 2)
}

// Only a moderator reaches the pages of sections: a guest goes to sign in and back, a member and a
// banned user get 403; nothing changes. Only a moderator gets the menu on the home.
func TestSectionsModRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	banned := forumtest.User(t, db, "banned", at(0))
	mod := newModerator(t, db, "mod")
	_, err := db.Exec(context.Background(), `
		INSERT INTO forum_bans (user_id, moderator_id, reason) VALUES ($1, $2, 'spam')`, banned, mod)
	assert.NilError(t, err)
	before := sectionIDs(t, f)
	id := before[1]
	form := url.Values{"name": {"new"}, "direction": {"up"}}
	gets := []string{sectionsURL, sectionsURL + "/new", sectionEditURL(id)}
	posts := []string{sectionsURL + "/new", sectionEditURL(id), sectionMoveURL(id)}

	h.userID = 0
	for _, target := range gets {
		assert.Equal(t, redirectedTo(t, h.get(t, f, target)), "/user/login")
	}
	for _, target := range posts {
		assert.Equal(t, redirectedTo(t, h.post(t, f, target, form)), "/user/login")
	}
	for _, user := range []int{alice, banned} {
		h.userID = user
		for _, target := range gets {
			assert.Equal(t, h.get(t, f, target).Code, http.StatusForbidden)
		}
		for _, target := range posts {
			assert.Equal(t, h.post(t, f, target, form).Code, http.StatusForbidden)
		}
	}
	assert.Equal(t, fmt.Sprint(sectionIDs(t, f)), fmt.Sprint(before))
	s, err := f.loadSectionByID(context.Background(), id)
	assert.NilError(t, err)
	if s.Name == "new" {
		t.Error("the section was renamed")
	}
	assert.Equal(t, len(modLog(t, db)), 0)

	for _, tt := range []struct {
		viewer int
		menu   bool
	}{{0, false}, {alice, false}, {banned, false}, {mod, true}} {
		h.userID = tt.viewer
		h.get(t, f, "/forum/")
		assert.Equal(t, strings.Contains(string(h.page.Body), `href="`+sectionsURL+`"`), tt.menu)
	}
}
