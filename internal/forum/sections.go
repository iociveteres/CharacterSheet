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

type homeData struct {
	view
	Sections []Section
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
