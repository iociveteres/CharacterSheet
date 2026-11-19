package forum

import (
	"context"
	"net/http"

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

func (f *Forum) sections(ctx context.Context) ([]Section, error) {
	rows, err := f.db.Query(ctx, `
		SELECT id, name, description, position, mods_only_topics
		FROM forum_sections
		ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Section])
}

func (f *Forum) home(w http.ResponseWriter, r *http.Request) {
	data := f.view(r)
	f.render(w, r, http.StatusOK, "home.html", data, Page{
		Title:       i18n.T(data.Lang, "forum.sections.title"),
		Description: i18n.T(data.Lang, "forum.sections.description"),
		Canonical:   f.baseURL + "/forum/",
	})
}
