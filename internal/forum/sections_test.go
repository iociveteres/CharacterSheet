package forum

import (
	"context"
	"net/http"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testHost signs in userID (0 is a guest) and keeps the server error instead of answering.
type testHost struct {
	userID int
	err    error
}

func (h *testHost) UserID(*http.Request) (int, bool)                     { return h.userID, h.userID != 0 }
func (h *testHost) CSRFToken(*http.Request) string                       { return "" }
func (h *testHost) PutFlash(*http.Request, string)                       {}
func (h *testHost) Render(http.ResponseWriter, *http.Request, int, Page) {}
func (h *testHost) NotFound(http.ResponseWriter, *http.Request)          {}
func (h *testHost) ServerError(_ http.ResponseWriter, _ *http.Request, err error) {
	h.err = err
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
	sections, err := f.sections(ctx)
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
	sections, err = f.sections(ctx)
	assert.NilError(t, err)
	assert.Equal(t, sections[0].ID, last.ID)
	assert.Equal(t, sections[0].Name, last.Name)
	assert.Equal(t, sections[0].Description, last.Description)
}
